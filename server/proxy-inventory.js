'use strict';

/**
 * Proxy Inventory - Track all proxies from all devices
 */
class ProxyInventory {
  constructor(db) {
    this.db = db;
  }

  /**
   * Update proxies from device heartbeat
   */
  async syncProxies(deviceId, proxies) {
    for (const p of proxies ?? []) {
      const proxyId = `${deviceId}:${p.id}`;
      await this.db.run(
        `INSERT OR REPLACE INTO proxies
         (proxyId, deviceId, allocId, localPort, country, exitIp, health, status, requestsTotal, bytesUp, bytesDown, latency, successRate, lastCheck, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proxyId,
          deviceId,
          p.id,
          p.localPort,
          p.country,
          p.exitIp,
          p.health ?? 100,
          p.status ?? 'unknown',
          p.requests ?? 0,
          p.bytesUp ?? 0,
          p.bytesDown ?? 0,
          p.latency ?? 0,
          p.successRate ?? 100,
          new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
    }
  }

  /**
   * Get all proxies
   */
  async getAllProxies() {
    return this.db.all(
      `SELECT * FROM proxies ORDER BY health DESC, country ASC`
    );
  }

  /**
   * Get proxies by country
   */
  async getProxiesByCountry(country) {
    return this.db.all(
      `SELECT * FROM proxies WHERE country = ? ORDER BY health DESC`,
      [country.toUpperCase()]
    );
  }

  /**
   * Get healthiest proxies
   */
  async getHealthiestProxies(limit = 10) {
    return this.db.all(
      `SELECT * FROM proxies WHERE status = 'online' ORDER BY health DESC LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get proxy by ID
   */
  async getProxy(proxyId) {
    return this.db.get(
      `SELECT * FROM proxies WHERE proxyId = ?`,
      [proxyId]
    );
  }

  /**
   * Get proxies by device
   */
  async getProxiesByDevice(deviceId) {
    return this.db.all(
      `SELECT * FROM proxies WHERE deviceId = ? ORDER BY health DESC`,
      [deviceId]
    );
  }

  /**
   * Record metric
   */
  async recordMetric(proxyId, latency, successRate, bytesUp, bytesDown) {
    await this.db.run(
      `INSERT INTO metrics (proxyId, latency, successRate, bytesUp, bytesDown)
       VALUES (?, ?, ?, ?, ?)`,
      [proxyId, latency, successRate, bytesUp, bytesDown]
    );
  }

  /**
   * Get metrics for proxy
   */
  async getMetrics(proxyId, limit = 100) {
    return this.db.all(
      `SELECT * FROM metrics WHERE proxyId = ? ORDER BY timestamp DESC LIMIT ?`,
      [proxyId, limit]
    );
  }

  /**
   * Get proxy stats
   */
  async getProxyStats(proxyId) {
    const metrics = await this.getMetrics(proxyId, 50);
    if (metrics.length === 0) return null;

    const avgLatency = metrics.reduce((sum, m) => sum + (m.latency || 0), 0) / metrics.length;
    const avgSuccess = metrics.reduce((sum, m) => sum + (m.successRate || 0), 0) / metrics.length;

    return {
      avgLatency: Math.round(avgLatency),
      avgSuccess: Math.round(avgSuccess * 100) / 100,
      minLatency: Math.min(...metrics.map(m => m.latency || 0)),
      maxLatency: Math.max(...metrics.map(m => m.latency || 0)),
    };
  }

  /**
   * Clean old metrics
   */
  async cleanupMetrics(maxAgeMs = 604800000) { // 7 days default
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    await this.db.run(
      `DELETE FROM metrics WHERE timestamp < ?`,
      [cutoff]
    );
  }
}

module.exports = { ProxyInventory };
