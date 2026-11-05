'use strict';

/**
 * Health Monitor - Track latency, success rate, failures for each proxy.
 * Polls each proxy periodically to detect issues early.
 */
class HealthMonitor {
  constructor({ checkInterval = 60000, timeWindow = 300000 } = {}) {
    this.checkInterval = checkInterval; // ms between health checks (configurable)
    this.timeWindow = timeWindow; // time window to track failures (5 min default)
    this.metrics = {}; // {[allocId]: {latency, successRate, failures[], lastCheck}}
    this.timer = null;
    this.onMetricsUpdate = null; // callback
  }

  /**
   * Initialize health monitoring for proxies.
   * @param {Array} proxies - [{itemId, exitHost, exitPort, scheme}]
   */
  init(proxies) {
    this.metrics = {};
    for (const p of proxies ?? []) {
      this.metrics[p.itemId] = {
        itemId: p.itemId,
        country: p.country,
        exitHost: p.exitHost,
        latency: null,
        successRate: 100, // assume healthy initially
        failures: [], // [timestamp, timestamp, ...]
        lastCheck: null,
        status: 'unknown', // unknown, healthy, warning, critical
      };
    }
  }

  /**
   * Start periodic health checks.
   * @param {Function} checkFn - async (itemId, exitHost, exitPort, scheme) => {ok, latency}
   */
  start(checkFn) {
    if (this.timer) return;
    this.checkFn = checkFn;
    this._runCheck();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async _runCheck() {
    try {
      const ids = Object.keys(this.metrics);
      const start = Date.now();

      // Check all proxies in parallel
      await Promise.all(ids.map((id) => this._checkProxy(id)));

      // Schedule next check
      const elapsed = Date.now() - start;
      const delay = Math.max(1000, this.checkInterval - elapsed);
      this.timer = setTimeout(() => this._runCheck(), delay);
    } catch (e) {
      console.error('[health-monitor] Error in check loop:', e.message);
      this.timer = setTimeout(() => this._runCheck(), this.checkInterval);
    }
  }

  async _checkProxy(itemId) {
    const m = this.metrics[itemId];
    if (!m) return;

    try {
      const start = Date.now();
      const result = await this.checkFn(itemId, m.exitHost, m.exitPort, m.scheme ?? 'http');
      const latency = Date.now() - start;

      if (result.ok) {
        m.latency = latency;
        m.lastCheck = new Date();
        // Success - remove old failures outside time window
        m.failures = m.failures.filter((t) => Date.now() - t < this.timeWindow);
        m.status = m.failures.length === 0 ? 'healthy' : 'warning';
      } else {
        // Failure
        m.failures.push(Date.now());
        m.status = m.failures.length >= 3 ? 'critical' : 'warning';
      }

      // Calculate success rate (recent)
      const recentChecks = 10; // last 10 checks
      m.successRate = Math.max(0, 100 - (Math.min(m.failures.length, recentChecks) / recentChecks) * 100);
    } catch (e) {
      // Network error
      m.failures.push(Date.now());
      m.status = m.failures.length >= 3 ? 'critical' : 'warning';
      m.lastCheck = new Date();
    }

    // Notify on update
    if (this.onMetricsUpdate) {
      this.onMetricsUpdate(m);
    }
  }

  /**
   * Get current metrics for a proxy.
   * @param {string} itemId
   * @returns {{latency, successRate, status, failures}}
   */
  getMetrics(itemId) {
    return this.metrics[itemId] ?? null;
  }

  /**
   * Get all metrics.
   * @returns {Object} {[itemId]: metrics}
   */
  getAllMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get proxy status summary.
   * @returns {{healthy: count, warning: count, critical: count}}
   */
  getStatus() {
    const summary = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    for (const m of Object.values(this.metrics)) {
      summary[m.status]++;
    }
    return summary;
  }

  /**
   * Get recentFailures for a proxy.
   * @param {string} itemId
   * @returns {number} count of failures in time window
   */
  getRecentFailures(itemId) {
    const m = this.metrics[itemId];
    if (!m) return 0;
    const cutoff = Date.now() - this.timeWindow;
    return m.failures.filter((t) => t > cutoff).length;
  }

  /**
   * Manually report failure (e.g., from ProxyEngine).
   * @param {string} itemId
   */
  reportFailure(itemId) {
    const m = this.metrics[itemId];
    if (m) {
      m.failures.push(Date.now());
      m.status = m.failures.length >= 3 ? 'critical' : 'warning';
      if (this.onMetricsUpdate) {
        this.onMetricsUpdate(m);
      }
    }
  }

  /**
   * Reset metrics for a proxy (e.g., after rotation).
   * @param {string} itemId
   */
  reset(itemId) {
    const m = this.metrics[itemId];
    if (m) {
      m.failures = [];
      m.latency = null;
      m.status = 'unknown';
    }
  }
}

module.exports = { HealthMonitor };
