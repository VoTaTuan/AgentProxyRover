'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProxyServer } = require('./proxy-engine');
const { BackendClient } = require('./backend-client');
const { BackendUpstreamProvider } = require('./upstream-provider');
const { HealthMonitor } = require('./health-monitor');
const { AutoRotator } = require('./auto-rotator');
const { PoolSyncClient } = require('./pool-sync-client');

const DEFAULTS = {
  bindIp: '127.0.0.1',
  portStart: 8801,
  portCount: 20,
  mcpPort: 6789, // local MCP server for AI agents (lib/mcp-server.js)
  rotationStrategy: 'manual', // manual, auto-fail, auto-slow, auto-both
  healthCheckInterval: '60000', // ms or 'perrequest' or 'manual'
  quotaAlertThreshold: 80, // percent
};

/**
 * Some pool exits carry an internal "<label>:<location>" identifier instead of
 * a plain host (e.g. "group:cambodia-phnom-penh"). When the remainder reads as
 * a location, strip the label for display wherever an exitHost is surfaced;
 * digit-only remainders ("sg:0") are kept as-is — they are pool node ids, and
 * stripping them would leave a meaningless "0". Plain IPv4/IPv6 and normal
 * hostnames pass through untouched.
 */
function cleanExitHost(host) {
  const s = String(host ?? '').trim();
  const m = /^[a-z][a-z0-9_-]*:(.+)$/i.exec(s);
  return m && /[a-z]/i.test(m[1]) ? m[1] : s;
}

/** Settings persisted under the app's userData dir. */
class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      /* first run */
    }
  }

  get() {
    return { ...this.data };
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}

/** Owns all ProxyServer instances for the current allocation. */
class ProxyManager {
  constructor(stateDir, onChange = () => {}, { appVersion = null, usageFlushMs = 60000 } = {}) {
    this.stateDir = stateDir;
    this.appVersion = appVersion;
    this.usageFlushMs = usageFlushMs;
    this.settings = new Settings(path.join(stateDir, 'settings.json'));
    this.client = new BackendClient(undefined, stateDir, { version: appVersion });
    this.servers = [];
    this.allocation = null;
    this.onChange = onChange;
    this.pollTimer = null;
    this.cmdVersion = -1;
    this.locked = false; // operator locked this DEVICE (worse than revoking proxies)
    this.quota = null; // reset quota from the backend (commands poll)
    this.lastSent = new Map(); // itemId -> usage already reported
    this.flushTimer = null;
    // Health monitoring & auto-rotation
    this.healthMonitor = null;
    this.autoRotator = null;
    this.healthCheckTimer = null;
    // Pool sync
    this.poolSync = null;
  }

  /** Fetch/refresh the allocation WITHOUT binding local ports. */
  async fetchAllocation() {
    this.allocation = await this.client.getAllocation();
    for (const it of this.allocation.items ?? []) it.exitHost = cleanExitHost(it.exitHost);
    this.onChange(this.state());
    return this.state();
  }

  /** Bind min(portCount, allocation length) local ports. */
  async start() {
    if (this.servers.length) return this.state();
    if (this.locked) throw new Error('device locked by operator');
    const s = this.settings.get();
    this.client = new BackendClient(undefined, this.stateDir, { version: this.appVersion });
    await this.fetchAllocation();
    if (!this.allocation.items.length) {
      throw new Error('no proxies in allocation (proxy pool unavailable)');
    }
    const count = Math.max(1, Math.min(s.portCount, this.allocation.items.length));
    for (let i = 0; i < count; i++) {
      const item = this.allocation.items[i];
      const provider = new BackendUpstreamProvider(this.client, item);
      const server = new ProxyServer(
        { name: `${item.country}-${item.exitHost}`, listen: `${s.bindIp}:${s.portStart + i}`, provider },
        () => {
          // Only call onChange if servers still exist (not destroyed)
          if (this.servers.length > 0) {
            this.onChange(this.state());
          }
        },
      );
      server.allocationItem = item;
      await server.start();
      this.servers.push(server);
    }
    this._startPolling();
    this._startUsageFlush();
    this._startHealthMonitoring();
    this._startPoolSync();
    // UI/MCP triggered start phải đẩy state "engines ready" — nếu không,
    // renderer kẹt ở placeholder "Press Connect…" cho tới khi có traffic.
    this.onChange(this.state());
    return this.state();
  }

  /**
   * Signaling channel — poll operator commands every few seconds. This is
   * tiny JSON, NOT user data: the data plane stays client -> exit direct.
   */
  _startPolling(intervalMs = 5000) {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      try {
        const cmds = await this.client.commands();
        if (cmds.quota && JSON.stringify(cmds.quota) !== JSON.stringify(this.quota)) {
          this.quota = cmds.quota;
          this.onChange(this.state());
        }
        const locked = Boolean(cmds.locked);
        if (locked !== this.locked) {
          this.locked = locked;
          if (locked) {
            // banned: cut every tunnel NOW, but keep polling so an unlock
            // is noticed and the user can connect again
            this._flushUsage();
            await this._stopEngines();
            this.onChange(this.state());
            return;
          }
          this.onChange(this.state());
          return;
        }
        if (cmds.version === this.cmdVersion) return;
        this.cmdVersion = cmds.version;
        const revokedSet = new Set(cmds.revoked ?? []);
        let changed = false;
        for (const srv of this.servers) {
          const shouldBeRevoked = revokedSet.has(srv.allocationItem?.id);
          if (srv.revoked !== shouldBeRevoked) {
            srv.setRevoked(shouldBeRevoked);
            if (!shouldBeRevoked) srv.def.provider.reportFailure?.(); // fresh creds on restore
            changed = true;
          }
        }
        if (changed) this.onChange(this.state());
      } catch {
        /* backend unreachable — keep serving with current creds */
      }
    }, intervalMs);
    this.pollTimer.unref?.();
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  _startHealthMonitoring() {
    const s = this.settings.get();
    let checkInterval = 60000;
    const hci = s.healthCheckInterval;
    if (hci === 'perrequest') {
      checkInterval = 0; // check on every request
    } else if (hci === 'manual') {
      checkInterval = Infinity; // never auto-check
    } else {
      checkInterval = Number(hci) || 60000;
    }
    const failureThreshold = s.failureThreshold ?? 3;
    const failureTimeWindow = s.failureTimeWindow ?? 300000; // 5 min default

    // Initialize health monitor
    this.healthMonitor = new HealthMonitor({
      checkInterval,
      timeWindow: failureTimeWindow,
    });

    this.healthMonitor.init(
      this.servers.map((srv) => ({
        itemId: srv.allocationItem?.id,
        country: srv.allocationItem?.country,
        exitHost: srv.allocationItem?.exitHost,
        exitPort: srv.allocationItem?.exitPort,
        scheme: srv.def.provider.cred?.scheme ?? 'http',
      })),
    );

    // Health check function - HTTP request to test proxy
    this.healthMonitor.checkFn = async (itemId, exitHost, exitPort, scheme) => {
      try {
        // Simple HTTP request to test proxy connectivity
        const proxyUrl = new URL(`http://httpbin.org/get`);
        const timeout = 5000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        return { ok: response.ok, latency: 0 };
      } catch (e) {
        return { ok: false, latency: 0 };
      }
    };

    // On metrics update - notify UI
    this.healthMonitor.onMetricsUpdate = () => {
      this.onChange(this.state());
    };

    // Initialize auto-rotator
    this.autoRotator = new AutoRotator({
      failureThreshold,
      timeWindow: failureTimeWindow,
      strategy: s.rotationStrategy || 'manual',
      latencyThreshold: 500,
    });

    this.autoRotator.onRotationNeeded = async (itemId) => {
      await this.rotate(itemId);
    };

    // Start health monitor
    this.healthMonitor.start(this.healthMonitor.checkFn);

    // Check health & auto-rotate every 10 seconds
    this.healthCheckTimer = setInterval(() => {
      for (const srv of this.servers) {
        const itemId = srv.allocationItem?.id;
        const metrics = this.healthMonitor.getMetrics(itemId);

        if (this.autoRotator.shouldRotate(metrics)) {
          this.autoRotator.queueRotation(itemId, this.quota);
        }
      }

      // Process rotation queue
      if (this.autoRotator.rotationCandidates.size > 0) {
        this.autoRotator.processQueue(this.quota).catch((e) => {
          console.error('[health-monitor] Auto-rotation error:', e.message);
        });
      }
    }, 10000);

    this.healthCheckTimer.unref?.();
  }

  _stopHealthMonitoring() {
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  _startPoolSync() {
    const s = this.settings.get();
    const poolServerUrl = s.poolServerUrl || process.env.POOL_SERVER_URL || 'http://localhost:3021';
    const poolSyncEnabled = s.poolSyncEnabled !== false; // default: enabled

    if (!poolSyncEnabled) {
      console.log('[pool-sync] Disabled in settings');
      return;
    }

    // Create sync client
    this.poolSync = new PoolSyncClient(poolServerUrl, this.client.deviceId, () => {
      // Return current proxies from state
      const state = this.state();
      return state.proxies;
    });

    // Register device (fire and forget)
    this.poolSync.register('Device').catch((e) => {
      console.error('[pool-sync] Register failed:', e.message);
    });

    // Start syncing
    this.poolSync.start();
    console.log('[pool-sync] Started:', poolServerUrl);
  }

  _stopPoolSync() {
    if (this.poolSync) {
      this.poolSync.stop();
      this.poolSync = null;
    }
  }

  /**
   * Rotate one proxy slot onto a different exit. Device-level quota
   * (20 resets per 20 min sliding window) is enforced by the backend; the
   * slot's live tunnels are killed so the next request rides the new exit.
   */
  async rotate(itemId) {
    const srv = this.servers.find((s) => s.allocationItem?.id === itemId);
    if (!srv) throw new Error('unknown proxy slot (not running)');
    const res = await this.client.rotateProxy(itemId);
    const item = res.item;
    if (item) item.exitHost = cleanExitHost(item.exitHost);
    this.allocation.items = (this.allocation.items ?? []).map((it) =>
      it.id === item.id
        ? { ...it, exitHost: cleanExitHost(item.exitHost), exitPort: item.exitPort, country: item.country, creds: undefined }
        : it,
    );
    srv.allocationItem = this.allocation.items.find((i) => i.id === item.id);
    srv.def.name = `${item.country}-${item.exitHost}`;
    srv.def.provider.setItem(srv.allocationItem);
    srv.killConnections();
    this.quota = res.quota ?? null;
    this.onChange(this.state());
    return { item: srv.allocationItem, quota: res.quota ?? null, totalResets: res.totalResets ?? null };
  }

  /** Rotate by local listen address (e.g. "127.0.0.1:8801"). */
  async rotateByListen(listen) {
    const srv = this.servers.find((s) => s.def.listen === listen);
    if (!srv) throw new Error(`no running proxy on ${listen}`);
    return this.rotate(srv.allocationItem?.id);
  }

  /**
   * Kill all engines (used by both disconnect and device-lock). Polling is
   * deliberately NOT stopped: a locked device must keep listening for the
   * operator's unlock.
   */
  async _stopEngines() {
    const engines = this.servers;
    this.servers = [];
    this._stopUsageFlush();
    this._stopHealthMonitoring();
    this._stopPoolSync();
    await Promise.all(engines.map((s) => s.stop()));
  }

  async stop() {
    this._flushUsage(); // report what's left before tearing down
    this.stopPolling();
    await this._stopEngines();
    this.onChange(this.state()); // đẩy "disconnected" tới UI kể cả khi stop từ MCP
    return this.state();
  }

  // ---- usage reporting: per-item deltas since the last accepted flush ----

  _collectUsage() {
    const items = [];
    for (const srv of this.servers) {
      const id = srv.allocationItem?.id;
      const u = srv.snapshot().usage;
      if (!id || !u) continue;
      const last = this.lastSent.get(id) ?? { requests: 0, bytesUp: 0, bytesDown: 0 };
      const delta = {
        id,
        requests: u.requests - last.requests,
        bytesUp: u.bytesUp - last.bytesUp,
        bytesDown: u.bytesDown - last.bytesDown,
      };
      if (delta.requests > 0 || delta.bytesUp > 0 || delta.bytesDown > 0) items.push(delta);
    }
    return items;
  }

  _flushUsage() {
    const items = this._collectUsage();
    if (!items.length) return;
    const prev = new Map(this.lastSent);
    for (const d of items) {
      const u = this.servers.find((s) => s.allocationItem?.id === d.id)?.snapshot().usage;
      if (u) this.lastSent.set(d.id, { ...u });
    }
    this.client.reportUsage(items).then((ok) => {
      if (!ok) this.lastSent = prev; // send the same delta again next round
    });
  }

  _startUsageFlush() {
    this._stopUsageFlush();
    this.flushTimer = setInterval(() => this._flushUsage(), this.usageFlushMs);
    this.flushTimer.unref?.();
  }

  _stopUsageFlush() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  state() {
    const s = this.settings.get();
    return {
      running: this.servers.length > 0,
      locked: this.locked,
      quota: this.quota ?? this.allocation?.quota ?? null,
      bindIp: s.bindIp,
      portStart: s.portStart,
      portCount: s.portCount,
      mcpPort: s.mcpPort,
      rotationStrategy: s.rotationStrategy,
      healthCheckInterval: s.healthCheckInterval,
      quotaAlertThreshold: s.quotaAlertThreshold,
      publicIp: this.client.publicIp,
      allocation: this.allocation,
      proxies: this.servers.map((srv, i) => {
        const snap = srv.snapshot();
        const item = srv.allocationItem ?? this.allocation?.items[i] ?? {};
        // exitHost: prefer the REAL exit resolved from the latest credential
        // (the pool may hand out a different host per issuance); fallback = item.
        const resolved = srv.def.provider?.resolvedExit ?? null;
        const itemId = srv.allocationItem?.id ?? null;
        const health = this.healthMonitor?.getMetrics(itemId) ?? null;
        return {
          listen: srv.def.listen,
          itemId,
          country: item.country,
          exitHost: cleanExitHost(resolved?.host ?? item.exitHost),
          exitPort: resolved?.port ?? item.exitPort,
          scheme: resolved?.scheme ?? item.scheme ?? 'http',
          provider: item.provider ?? 'free-pool',
          revoked: srv.revoked,
          active: snap.active,
          stats: snap.stats,
          usage: snap.usage,
          health,
        };
      }),
    };
  }

  saveSettings(patch) {
    return this.settings.set(patch);
  }
}

module.exports = { ProxyManager, Settings, DEFAULTS };
