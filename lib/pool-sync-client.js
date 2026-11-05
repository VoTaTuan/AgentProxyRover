'use strict';

/**
 * Pool Sync Client - Send device data to backend pool manager periodically
 */
class PoolSyncClient {
  constructor(backendUrl = 'http://localhost:3000', deviceId, getProxiesFn) {
    this.backendUrl = backendUrl.replace(/\/$/, ''); // remove trailing slash
    this.deviceId = deviceId;
    this.getProxiesFn = getProxiesFn;
    this.syncInterval = 30000; // 30 seconds
    this.syncTimer = null;
    this.enabled = true;
  }

  /**
   * Start sync loop
   */
  start() {
    if (this.syncTimer) return;
    this._runSync();
  }

  /**
   * Stop sync loop
   */
  stop() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async _runSync() {
    if (!this.enabled) return;

    try {
      await this._sync();
    } catch (e) {
      console.error('[pool-sync] Sync failed:', e.message);
    }

    // Schedule next sync
    this.syncTimer = setTimeout(() => this._runSync(), this.syncInterval);
    this.syncTimer.unref?.();
  }

  /**
   * Perform sync
   */
  async _sync() {
    // Get current proxies from local manager
    const proxies = this.getProxiesFn?.();
    if (!proxies) return;

    // Prepare sync payload
    const payload = {
      deviceId: this.deviceId,
      status: 'online',
      timestamp: new Date().toISOString(),
      proxies: proxies.map(p => ({
        id: p.itemId,
        localPort: parseInt(p.listen.split(':')[1]),
        country: p.country,
        exitIp: p.exitHost,
        health: p.health?.successRate ?? 100,
        status: p.health?.status ?? 'unknown',
        latency: p.health?.latency ?? null,
        successRate: p.health?.successRate ?? 100,
        requests: p.usage?.requests ?? 0,
        bytesUp: p.usage?.bytesUp ?? 0,
        bytesDown: p.usage?.bytesDown ?? 0,
      })),
    };

    // Send to backend
    const response = await fetch(`${this.backendUrl}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || 'Unknown error');
    }
  }

  /**
   * Register device on backend
   */
  async register(name = 'Device') {
    const response = await fetch(`${this.backendUrl}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: this.deviceId, name }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get status from backend
   */
  async getStatus() {
    const response = await fetch(`${this.backendUrl}/api/stats`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }
}

module.exports = { PoolSyncClient };
