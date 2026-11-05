'use strict';

/**
 * Load Balancer - Select best proxy based on strategy
 */
class LoadBalancer {
  constructor(inventory) {
    this.inventory = inventory;
    this.roundRobinIndex = 0;
  }

  /**
   * Select proxy based on criteria
   * @param {Object} opts - {strategy, country, excludeOffline}
   * @returns {Object} {proxyId, deviceId, localPort, country, health}
   */
  async selectProxy(opts = {}) {
    const {
      strategy = 'bestHealth',
      country = null,
      excludeOffline = true,
    } = opts;

    let proxies = await this.inventory.getAllProxies();

    // Filter offline
    if (excludeOffline) {
      proxies = proxies.filter(p => p.status !== 'offline');
    }

    // Filter by country
    if (country) {
      proxies = proxies.filter(p => p.country === country.toUpperCase());
    }

    if (!proxies.length) {
      throw new Error('No suitable proxies available');
    }

    // Select based on strategy
    switch (strategy) {
      case 'roundRobin':
        return this._selectRoundRobin(proxies);
      case 'leastUsed':
        return this._selectLeastUsed(proxies);
      case 'bestHealth':
      default:
        return this._selectBestHealth(proxies);
    }
  }

  /**
   * Round-robin selection
   */
  _selectRoundRobin(proxies) {
    const idx = this.roundRobinIndex % proxies.length;
    this.roundRobinIndex++;
    return proxies[idx];
  }

  /**
   * Least-used selection (fewest requests)
   */
  _selectLeastUsed(proxies) {
    return proxies.reduce((best, current) => {
      return (current.requestsTotal || 0) < (best.requestsTotal || 0) ? current : best;
    });
  }

  /**
   * Best-health selection
   */
  _selectBestHealth(proxies) {
    return proxies.reduce((best, current) => {
      return (current.health || 0) > (best.health || 0) ? current : best;
    });
  }

  /**
   * Get available countries
   */
  async getCountries() {
    const proxies = await this.inventory.getAllProxies();
    const countries = [...new Set(proxies.map(p => p.country).filter(Boolean))];
    return countries.sort();
  }

  /**
   * Get proxy stats by country
   */
  async getCountryStats() {
    const proxies = await this.inventory.getAllProxies();
    const stats = {};

    for (const p of proxies) {
      if (!p.country) continue;
      if (!stats[p.country]) {
        stats[p.country] = { count: 0, avgHealth: 0, online: 0 };
      }
      stats[p.country].count++;
      stats[p.country].avgHealth += p.health || 0;
      if (p.status === 'online') stats[p.country].online++;
    }

    // Calculate averages
    for (const country in stats) {
      stats[country].avgHealth = Math.round(stats[country].avgHealth / stats[country].count);
    }

    return stats;
  }
}

module.exports = { LoadBalancer };
