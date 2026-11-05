'use strict';

/**
 * Proxy Client SDK - Client library để sử dụng pooled proxies
 */
class ProxyClient {
  constructor(backendUrl = 'http://localhost:3021') {
    this.backendUrl = backendUrl.replace(/\/$/, '');
    this.timeout = 5000;
    this.lastProxy = null;
  }

  /**
   * Select best proxy based on criteria
   * @param {Object} opts - {strategy, country}
   * @returns {Object} {proxyId, deviceId, localPort, country, health}
   */
  async selectProxy(opts = {}) {
    const { strategy = 'bestHealth', country = null } = opts;

    try {
      const response = await this._fetch('/api/proxies/select', {
        method: 'POST',
        body: JSON.stringify({ strategy, country }),
      });

      const { proxy } = await response.json();
      this.lastProxy = proxy;
      return proxy;
    } catch (e) {
      console.error('[proxy-client] selectProxy failed:', e.message);
      throw e;
    }
  }

  /**
   * Get available countries
   * @returns {Object} {countries: [], stats: {}}
   */
  async getCountries() {
    try {
      const response = await this._fetch('/api/proxies/countries');
      return response.json();
    } catch (e) {
      console.error('[proxy-client] getCountries failed:', e.message);
      throw e;
    }
  }

  /**
   * Get all proxies
   * @param {string} country - optional filter
   * @returns {Object} {proxies: [], count: number}
   */
  async getProxies(country = null) {
    try {
      const url = country ? `/api/proxies?country=${country}` : '/api/proxies';
      const response = await this._fetch(url);
      return response.json();
    } catch (e) {
      console.error('[proxy-client] getProxies failed:', e.message);
      throw e;
    }
  }

  /**
   * Report proxy failure
   * @param {string} proxyId
   */
  async reportFailure(proxyId) {
    try {
      await this._fetch('/api/metrics', {
        method: 'POST',
        body: JSON.stringify({
          proxyId,
          latency: 0,
          successRate: 0, // 0 = failure
        }),
      });
    } catch (e) {
      console.error('[proxy-client] reportFailure failed:', e.message);
      // don't throw - this is fire and forget
    }
  }

  /**
   * Report success & metrics
   * @param {string} proxyId
   * @param {number} latency - ms
   * @param {number} bytesUp
   * @param {number} bytesDown
   */
  async reportSuccess(proxyId, latency = 0, bytesUp = 0, bytesDown = 0) {
    try {
      await this._fetch('/api/metrics', {
        method: 'POST',
        body: JSON.stringify({
          proxyId,
          latency,
          successRate: 100,
          bytesUp,
          bytesDown,
        }),
      });
    } catch (e) {
      console.error('[proxy-client] reportSuccess failed:', e.message);
      // don't throw
    }
  }

  /**
   * Get proxy health & stats
   * @param {string} proxyId
   */
  async getProxyStats(proxyId) {
    try {
      const response = await this._fetch(`/api/proxies/${proxyId}`);
      return response.json();
    } catch (e) {
      console.error('[proxy-client] getProxyStats failed:', e.message);
      throw e;
    }
  }

  /**
   * Get pool stats
   */
  async getPoolStats() {
    try {
      const response = await this._fetch('/api/stats');
      return response.json();
    } catch (e) {
      console.error('[proxy-client] getPoolStats failed:', e.message);
      throw e;
    }
  }

  /**
   * Check backend health
   */
  async healthCheck() {
    try {
      const response = await this._fetch('/health');
      return response.json();
    } catch (e) {
      return { status: 'offline', error: e.message };
    }
  }

  /**
   * Internal fetch with error handling
   */
  async _fetch(path, opts = {}) {
    const url = `${this.backendUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...opts.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }
}

module.exports = { ProxyClient };
