'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * Backend API client. The device identity is LOCKED to the machine's physical
 * network adapter MAC: reinstalling, wiping userData or copying the app still
 * yields the SAME deviceId. (Quota is additionally keyed by public IP.)
 *
 * The backend URL is FIXED at build time and is not user-configurable.
 * (BACKEND_URL env exists purely for developer testing.)
 */
const PROD_BACKEND_URL = 'https://api-proxy.shiplo.site/api/v1';

const ZERO_MAC = /^0{2}(:0{2}){5}$/;

class BackendClient {
  constructor(_ignoredUrl, stateDir, { version = null } = {}) {
    this.baseUrl = (process.env.BACKEND_URL ?? PROD_BACKEND_URL).replace(/\/+$/, '');
    this.deviceFile = path.join(stateDir, 'device.json');
    this.deviceId = null;
    this.deviceToken = null;
    this.publicIp = null;
    this.mac = null; // physical MAC the identity is locked to (cached)
    this.version = version; // reported to the operator panel on register
    this._loadDevice();
  }

  _loadDevice() {
    try {
      const j = JSON.parse(fs.readFileSync(this.deviceFile, 'utf8'));
      this.deviceId = j.deviceId ?? null;
      this.deviceToken = j.deviceToken ?? null;
      this.mac = j.mac ?? null;
    } catch {
      /* first run */
    }
  }

  _saveDevice() {
    fs.mkdirSync(path.dirname(this.deviceFile), { recursive: true });
    fs.writeFileSync(
      this.deviceFile,
      JSON.stringify({ deviceId: this.deviceId, deviceToken: this.deviceToken, mac: this.mac }, null, 2),
    );
  }

  /**
   * MAC of a physical, enabled adapter — stable across reinstalls.
   * Windows: WMI PhysicalAdapter=TRUE (excludes Hyper-V/VirtualBox/TAP …),
   * Ethernet preferred over Wi-Fi (Windows "Random hardware addresses"
   * randomizes Wi-Fi MACs), Bluetooth excluded, smallest MAC as tiebreak so
   * the pick stays deterministic regardless of enumeration order.
   */
  async _stableMac() {
    if (this.mac) return this.mac;
    const mac = (await this._macFromWindows()) ?? this._macFromNodeFallback();
    if (mac) this.mac = mac;
    return mac;
  }

  /**
   * Wired NICs before Wi-Fi (Windows "Random hardware addresses" rotates
   * Wi-Fi MACs), smallest MAC as final tiebreak — deterministic.
   */
  _pickMac(adapters) {
    const wired = adapters.filter((a) => !/wi-?fi|wireless|802\.11/i.test(a.name));
    const pool = wired.length ? wired : adapters;
    const nic = pool.filter((a) => /ethernet|gbe|gige|realtek|intel/i.test(a.name));
    return ((nic.length ? nic : pool).map((a) => a.mac).sort()[0]) ?? null;
  }

  _macFromWindows() {
    return new Promise((resolve) => {
      // PhysicalAdapter=TRUE alone (no NetEnabled) — a DISABLED NIC still
      // reports its MAC, so toggling adapters in Device Manager never drifts
      // the identity. Hyper-V/Kaspersky tunnels leak through the flag as
      // "physical": drop them by name.
      const ps =
        'Get-CimInstance Win32_NetworkAdapter -Filter "PhysicalAdapter=TRUE" ' +
        '| Select-Object Name,MACAddress | ConvertTo-Json -Compress';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          let list = JSON.parse(stdout);
          if (!Array.isArray(list)) list = [list];
          const adapters = list
            .filter((a) => a?.MACAddress && !/bluetooth|virtual|hyper|vpn|tunnel|tap|wsl/i.test(String(a.Name ?? '')))
            .map((a) => ({ name: String(a.Name ?? ''), mac: String(a.MACAddress).replace(/-/g, ':').toLowerCase() }))
            .filter((a) => !ZERO_MAC.test(a.mac));
          resolve(this._pickMac(adapters));
        } catch {
          resolve(null);
        }
      });
    });
  }

  _macFromNodeFallback() {
    const adapters = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (!a?.mac || ZERO_MAC.test(a.mac)) continue;
        if (/virtual|vethernet|vmware|virtualbox|loopback|bluetooth|tap|tun|wsl|hyper|parallels/i.test(name)) continue;
        adapters.push({ name, mac: a.mac.toLowerCase() });
      }
    }
    return this._pickMac(adapters);
  }

  /**
   * Device id = hash of the machine's MAC (`mac-<16 hex>`). When the derived
   * id differs from the stored one (first run after an old UUID install,
   * adapter change), drop the old token so the next call re-binds cleanly.
   */
  async _ensureDeviceId() {
    const mac = await this._stableMac();
    if (mac) {
      const id = 'mac-' + crypto.createHash('sha256').update(mac).digest('hex').slice(0, 16);
      if (id !== this.deviceId) {
        this.deviceId = id;
        this.deviceToken = null;
        this._saveDevice();
      }
      return;
    }
    if (!this.deviceId) this.deviceId = crypto.randomUUID(); // last resort: no MAC found
  }

  async _req(method, pathname, { body, auth = true, _retried = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && this.deviceToken) headers.Authorization = `Bearer ${this.deviceToken}`;
    const res = await fetch(this.baseUrl + pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      // Token issued by a DIFFERENT backend install (e.g. dev -> prod switch,
      // or the server's device store was reset): re-register with the SAME
      // deviceId (idempotent server-side) and retry once.
      if (res.status === 401 && auth && this.deviceToken && !_retried) {
        await this.register();
        return this._req(method, pathname, { body, auth: true, _retried: true });
      }
      const err = new Error(json?.error?.message ?? `HTTP ${res.status} ${pathname}`);
      err.code = json?.error?.code ?? res.status;
      throw err;
    }
    return json;
  }

  /** Register this deviceId (idempotent) and persist the issued token. */
  async register() {
    await this._ensureDeviceId();
    const reg = await this._req('POST', '/v1/devices', {
      body: { deviceId: this.deviceId, ...(this.version ? { version: this.version } : {}) },
      auth: false,
    });
    this.deviceToken = reg.deviceToken;
    this.publicIp = reg.ip;
    this._saveDevice();
  }

  /**
   * Per-proxy usage deltas (requests + bytes). Fire-and-forget: returns true
   * when accepted, false on any failure so the caller can re-report later.
   */
  async reportUsage(items) {
    try {
      await this._req('POST', '/v1/usage', { body: { items, version: this.version } });
      return true;
    } catch {
      return false;
    }
  }

  /** Register if needed and return the allocation bound to this public IP. */
  async getAllocation() {
    if (!this.deviceToken) await this.register();
    const alloc = await this._req('GET', '/v1/allocation');
    this.publicIp = alloc.ip;
    return alloc;
  }

  async credentials(allocId, { force = false } = {}) {
    const q = force ? '?force=1' : '';
    return this._req('GET', `/v1/allocation/${allocId}/credentials${q}`);
  }

  async reportFailure(allocId) {
    try {
      await this._req('POST', `/v1/allocation/${allocId}/failure`);
    } catch {
      /* best effort */
    }
  }

  /** Operator commands (revoked ids, locked, reset quota). Polled every ~5s. */
  async commands() {
    return this._req('GET', '/v1/commands');
  }

  /** Rotate one allocation slot onto a different exit (quota-limited). */
  async rotateProxy(allocId) {
    return this._req('POST', `/v1/allocation/${allocId}/rotate`);
  }
}

module.exports = { BackendClient };
