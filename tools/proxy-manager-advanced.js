'use strict';

const { ProxyClient } = require('../client/proxy-client');

/**
 * Advanced Proxy Management - Load balancing, geo-rotation, circuit breaker
 */
class AdvancedProxyManager {
  constructor(backendUrl = 'http://localhost:3000') {
    this.client = new ProxyClient(backendUrl);
    this.failedProxies = new Map(); // proxyId -> {failCount, lastFailTime}
    this.circuitBreakerThreshold = 5; // failures before disable
    this.circuitBreakerResetMs = 600000; // 10 minutes
    this.requestCount = 0;
    this.requestsByProxy = new Map();
  }

  /**
   * Load-balance across proxies
   * Distributes requests evenly
   */
  async selectLoadBalanced(country = null) {
    const { proxies } = await this.client.getProxies(country);
    const onlineProxies = proxies.filter(
      (p) => !this._isCircuitBreakerOpen(p.proxyId)
    );

    if (!onlineProxies.length) {
      throw new Error('No healthy proxies available');
    }

    // Find proxy with least requests
    let bestProxy = onlineProxies[0];
    let minRequests = this.requestsByProxy.get(bestProxy.proxyId) || 0;

    for (const p of onlineProxies) {
      const count = this.requestsByProxy.get(p.proxyId) || 0;
      if (count < minRequests) {
        bestProxy = p;
        minRequests = count;
      }
    }

    // Track request
    this.requestsByProxy.set(
      bestProxy.proxyId,
      (this.requestsByProxy.get(bestProxy.proxyId) || 0) + 1
    );
    this.requestCount++;

    return bestProxy;
  }

  /**
   * Geo-rotation - Rotate through countries for each request
   */
  async selectGeoRotated() {
    const { countries } = await this.client.getCountries();
    if (!countries.length) {
      throw new Error('No countries available');
    }

    // Rotate country based on request count
    const idx = this.requestCount % countries.length;
    const country = countries[idx];
    this.requestCount++;

    return this.client.selectProxy({ country });
  }

  /**
   * Circuit breaker - Disable proxies after repeated failures
   */
  async reportFailure(proxyId) {
    const failed = this.failedProxies.get(proxyId) || { failCount: 0, lastFailTime: null };
    failed.failCount++;
    failed.lastFailTime = Date.now();

    this.failedProxies.set(proxyId, failed);

    // Report to backend
    await this.client.reportFailure(proxyId);

    if (failed.failCount >= this.circuitBreakerThreshold) {
      console.warn(
        `[circuit-breaker] Proxy ${proxyId} disabled after ${failed.failCount} failures`
      );
    }
  }

  /**
   * Check if circuit breaker is open for proxy
   */
  _isCircuitBreakerOpen(proxyId) {
    const failed = this.failedProxies.get(proxyId);
    if (!failed || failed.failCount < this.circuitBreakerThreshold) {
      return false;
    }

    // Check if reset period expired
    const timeSinceLastFailure = Date.now() - failed.lastFailTime;
    if (timeSinceLastFailure > this.circuitBreakerResetMs) {
      // Reset circuit breaker
      this.failedProxies.delete(proxyId);
      console.log(`[circuit-breaker] Proxy ${proxyId} reset after timeout`);
      return false;
    }

    return true;
  }

  /**
   * Get stats per proxy (load distribution)
   */
  async getLoadDistribution() {
    const { proxies } = await this.client.getProxies();
    const distribution = {};

    for (const p of proxies) {
      distribution[p.proxyId] = {
        country: p.country,
        health: p.health,
        requests: this.requestsByProxy.get(p.proxyId) || 0,
        failed: (this.failedProxies.get(p.proxyId)?.failCount || 0),
        circuitOpen: this._isCircuitBreakerOpen(p.proxyId),
      };
    }

    return distribution;
  }

  /**
   * Rate limiter - Respect Shiplo quota
   * 20 rotations per 20 minutes, track usage
   */
  async checkQuota() {
    const stats = await this.client.getPoolStats();
    // stats has quota info from backend
    return stats;
  }

  /**
   * Reset statistics
   */
  reset() {
    this.requestCount = 0;
    this.requestsByProxy.clear();
    this.failedProxies.clear();
  }
}

module.exports = { AdvancedProxyManager };
