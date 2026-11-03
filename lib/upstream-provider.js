'use strict';

/**
 * One provider per allocation item (one pinned exit). Pulls Basic-Auth
 * credentials from the backend and caches them until shortly before expiry;
 * a failure report forces a fresh credential on the next acquire.
 */
class BackendUpstreamProvider {
  constructor(client, item, { refreshMarginMs = 120000 } = {}) {
    this.client = client;
    this.item = item; // {id, country, exitHost, exitPort}
    this.refreshMarginMs = refreshMarginMs;
    this.cred = null;
    this.lastError = null;
  }

  async acquireUpstream() {
    if (this.cred && Date.now() + this.refreshMarginMs < this.cred.expiresAt) {
      return this._toUpstream();
    }
    const force = this._forced || false;
    this._forced = false;
    try {
      this.cred = await this.client.credentials(this.item.id, { force });
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      throw e;
    }
    return this._toUpstream();
  }

  /** Swap the backing allocation item (exit rotation) and drop cached creds. */
  setItem(item) {
    this.item = item;
    this.cred = null;
    this._forced = false;
    this.lastError = null;
  }

  /** Most recently resolved REAL exit (the pool rotates hosts per issuance) — for the UI. */
  get resolvedExit() {
    if (!this.cred) return null;
    return { host: this.cred.exitHost, port: this.cred.exitPort, scheme: this.cred.scheme ?? 'http' };
  }

  reportFailure() {
    this._forced = true;
    this.cred = null;
    this.client.reportFailure(this.item.id);
  }

  _toUpstream() {
    return {
      host: this.cred.exitHost ?? this.item.exitHost,
      port: this.cred.exitPort ?? this.item.exitPort,
      // scheme from backend credentials (https = upstream proxy speaks TLS);
      // default http for older allocations (backwards compatibility).
      scheme: this.cred.scheme ?? 'http',
      username: this.cred.username,
      password: this.cred.password,
      expiresAt: this.cred.expiresAt,
      meta: { id: this.item.id, country: this.item.country },
    };
  }
}

module.exports = { BackendUpstreamProvider };
