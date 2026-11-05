'use strict';

const { ProxyClient } = require('./proxy-client');

/**
 * HTTP Wrapper - Automatically route requests through proxy
 */
class HttpWithProxy {
  constructor(backendUrl = 'http://localhost:3021', opts = {}) {
    this.client = new ProxyClient(backendUrl);
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeout = opts.timeout ?? 30000;
    this.sessions = new Map(); // proxyId -> sessionData
  }

  /**
   * Make request via proxy
   * @param {string} url - target URL
   * @param {Object} opts - fetch options
   * @param {Object} selectOpts - {strategy, country} for proxy selection
   * @returns {Response}
   */
  async fetch(url, opts = {}, selectOpts = {}) {
    let lastError;
    let retries = 0;

    while (retries < this.maxRetries) {
      try {
        // Select proxy
        const proxy = await this.client.selectProxy(selectOpts);
        const proxyUrl = `http://${proxy.deviceId}:${proxy.localPort}`; // local proxy address

        // Make request via proxy
        const start = Date.now();
        const response = await this._fetchViaProxy(url, proxyUrl, opts);
        const latency = Date.now() - start;

        // Report success
        await this.client.reportSuccess(proxy.proxyId, latency);

        return response;
      } catch (e) {
        lastError = e;
        retries++;

        if (retries < this.maxRetries) {
          console.warn(`[http-with-proxy] Request failed, retrying... (${retries}/${this.maxRetries})`);
          await this._sleep(1000 * retries); // backoff
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Fetch via proxy (internal)
   */
  async _fetchViaProxy(targetUrl, proxyUrl, opts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // For HTTP proxy, we need to make absolute-URI request
      const response = await fetch(targetUrl, {
        ...opts,
        signal: controller.signal,
        // Proxy-specific headers
        headers: {
          ...opts.headers,
          'Proxy-Authorization': `Basic ${Buffer.from('user:pass').toString('base64')}`,
        },
      });

      clearTimeout(timeoutId);
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Get session data for proxy (e.g., auth tokens)
   */
  getSession(proxyId) {
    return this.sessions.get(proxyId) || {};
  }

  /**
   * Store session data for proxy
   */
  setSession(proxyId, data) {
    this.sessions.set(proxyId, { ...this.getSession(proxyId), ...data });
  }

  /**
   * Clear session
   */
  clearSession(proxyId) {
    this.sessions.delete(proxyId);
  }

  /**
   * Get pool stats
   */
  async getStats() {
    return this.client.getPoolStats();
  }
}

module.exports = { HttpWithProxy };
