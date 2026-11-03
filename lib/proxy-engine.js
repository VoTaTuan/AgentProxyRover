'use strict';

/**
 * Local forward proxy engine (single port = single pinned upstream).
 * HTTPS: client CONNECT -> upstream CONNECT -> raw relay.
 * HTTP:  absolute-URI request forwarded with Proxy-Authorization.
 * 407/timeout -> provider.reportFailure() -> retry with fresh upstream.
 */

const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');

const HOP_BY_HOP = new Set([
  'connection', 'proxy-connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'upgrade',
]);

function basicAuth(upstream) {
  return `Basic ${Buffer.from(`${upstream.username}:${upstream.password}`).toString('base64')}`;
}

function log(tag, ...a) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...a);
}

class ProxyServer {
  /** @param {{name:string, listen:string, provider:object}} def */
  constructor(def, onEvent = () => {}) {
    this.def = def;
    this.onEvent = onEvent;
    this.server = http.createServer((req, res) => this._onPlainHttp(req, res));
    this.server.on('connect', (req, sock, head) => this._onConnect(req, sock, head));
    this.stats = { connectOk: 0, connectFail: 0, httpOk: 0, httpFail: 0 };
    this.usage = { requests: 0, bytesUp: 0, bytesDown: 0 }; // reported to backend
    this.revoked = false;
    this.sockets = new Set(); // every live client+upstream socket (for kill)
    this.active = 0; // live client connections, for the UI Active column
  }

  async start() {
    const [host, port] = this.def.listen.split(':');
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(Number(port), host, () => resolve());
    });
    log(this.def.name, `listening on ${this.def.listen}`);
  }

  stop() {
    this.killConnections();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      // browsers hold idle keep-alive sockets on our port — without this,
      // close() would wait on them forever and Disconnect would never finish
      this.server.closeIdleConnections?.();
      this.server.closeAllConnections?.();
      setTimeout(resolve, 3000).unref?.(); // safety net: always resolve
    });
  }

  /** Operator shutdown: destroy every live tunnel; new ones get 503 until un-revoked. */
  setRevoked(flag) {
    if (this.revoked === flag) return;
    this.revoked = flag;
    log(this.def.name, flag ? 'REVOKED by operator — killing connections' : 'restored by operator');
    if (flag) this.killConnections();
    this.onEvent('revoked', flag);
  }

  killConnections() {
    for (const sock of this.sockets) {
      try {
        sock.destroy();
      } catch {
        /* already dead */
      }
    }
    this.sockets.clear();
    this.active = 0;
  }

  snapshot() {
    return {
      name: this.def.name,
      listen: this.def.listen,
      revoked: this.revoked,
      active: this.active,
      stats: { ...this.stats },
      usage: { ...this.usage },
    };
  }

  _guard(res) {
    if (this.revoked) {
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('proxy revoked by operator');
      return true;
    }
    return false;
  }

  _onConnect(req, clientSock, head) {
    if (this.revoked) {
      clientSock.write('HTTP/1.1 503 proxy revoked\r\nConnection: close\r\n\r\n');
      return clientSock.destroy();
    }
    this._establish(req.url, clientSock, head, req.headers['user-agent']);
  }

  async _establish(target, clientSock, head, userAgent, tries = 0) {
    if (tries >= 3) return this._reject(clientSock, 502, 'upstream failed');
    let upstream;
    try {
      upstream = await this.def.provider.acquireUpstream();
    } catch (e) {
      log(this.def.name, 'no upstream:', e.message);
      return this._reject(clientSock, 502, 'no upstream');
    }
    const result = await this._tunnel(upstream, target, clientSock, head, userAgent);
    if (result === 'ok') {
      this.stats.connectOk++;
      this.onEvent('connect-ok');
      return;
    }
    this.stats.connectFail++;
    this.onEvent('connect-fail', result);
    this.def.provider.reportFailure?.(upstream, new Error(result));
    if (!clientSock.destroyed) return this._establish(target, clientSock, head, userAgent, tries + 1);
  }

  _tunnel(upstream, target, clientSock, head, userAgent = 'Mozilla/5.0') {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      let buffered = head && head.length ? [head] : [];
      let connected = false;

      const up = upstream.scheme === 'https'
        ? tls.connect({ host: upstream.host, port: upstream.port, servername: upstream.host, rejectUnauthorized: false })
        : net.connect(upstream.port, upstream.host);
      this.sockets.add(clientSock);
      this.sockets.add(up);
      const untrack = () => {
        this.sockets.delete(clientSock);
        this.sockets.delete(up);
      };
      // Hard connect-guard: timeout() không đáng tin khi DNS/SYN treo.
      up.setMaxListeners(0);
      const guard = setTimeout(() => {
        if (!up.readyState || up.readyState === 'opening') {
          up.destroy();
          up.emit('error', new Error('connect timeout (hard guard)'));
        }
      }, 12000);
      up.once('connect', () => clearTimeout(guard));
      up.once('close', () => clearTimeout(guard));
      up.once('error', () => clearTimeout(guard));
      up.setTimeout(12000);

      const onData = (chunk) => {
        if (connected) return;
        buffered.push(chunk);
        const joined = Buffer.concat(buffered);
        const idx = joined.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const statusLine = joined.slice(0, idx).toString('latin1').split('\r\n')[0];
        const code = Number(statusLine.split(' ')[1]);
        if (code >= 200 && code < 300) {
          up.setTimeout(0);
          up.removeListener('data', onData);
          connected = true;
          this.active++;
          this.usage.requests++;
          // extra listeners beside the pipes: pure byte counters
          clientSock.on('data', (c) => { this.usage.bytesUp += c.length; });
          up.on('data', (c) => { this.usage.bytesDown += c.length; });
          const rest = joined.slice(idx + 4);
          clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (rest.length) clientSock.write(rest);
          clientSock.pipe(up);
          up.pipe(clientSock);
          let saidBye = false;
          const bye = () => {
            if (saidBye) return;
            saidBye = true;
            untrack();
            this.active = Math.max(0, this.active - 1);
            this.onEvent('tunnel-end'); // UI: Active column back to 0
            done('ok');
          };
          clientSock.on('error', bye);
          up.on('error', bye);
          clientSock.on('close', bye);
          up.on('close', bye);
          done('ok');
        } else if (code === 407) {
          untrack();
          up.destroy();
          done('407');
        } else {
          untrack();
          up.destroy();
          done(`refused: ${statusLine}`);
        }
      };

      up.on('data', onData);
      up.on('connect', () => {
        up.write(
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n` +
            `Proxy-Authorization: ${basicAuth(upstream)}\r\n` +
            `Proxy-Connection: keep-alive\r\nUser-Agent: ${userAgent}\r\n\r\n`,
        );
      });
      up.on('error', (e) => {
        untrack();
        up.destroy();
        done(`error: ${e.message}`);
      });
      up.on('timeout', () => {
        untrack();
        up.destroy();
        done('timeout');
      });
      clientSock.on('error', () => {
        untrack();
        up.destroy();
        done('client error');
      });
      clientSock.on('data', (c) => {
        if (!connected) buffered.push(c);
      });
    });
  }

  _onPlainHttp(req, res) {
    if (req.url === '/__status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.snapshot()));
      return;
    }
    if (this._guard(res)) return;
    if (!/^https?:\/\//i.test(req.url)) {
      res.writeHead(400).end('forward proxy required');
      return;
    }
    this._forward(req, res);
  }

  async _forward(req, res, retried = false) {
    let upstream;
    try {
      upstream = await this.def.provider.acquireUpstream();
    } catch (e) {
      res.writeHead(502).end('no upstream');
      return;
    }
    const body = await this._readBody(req);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    headers['proxy-authorization'] = basicAuth(upstream);

    if (!retried) {
      this.sockets.add(req.socket); // so revoke kills in-flight HTTP too
      this.active++;
    }
    this.usage.requests++;
    // count the wire headers too, so bodyless GETs still register traffic
    this.usage.bytesUp += body.length +
      Object.entries(headers).reduce((n, [k, v]) => n + k.length + 2 + String(v).length + 2, 0) +
      16; // request line + CRLF
    // fires once per client socket: Set.delete returns false on the 2nd call
    const release = () => {
      if (this.sockets.delete(req.socket)) {
        this.active = Math.max(0, this.active - 1);
        this.onEvent('http-done'); // UI: Active column back to 0
      }
    };
    res.on('finish', release);
    res.on('close', release);

    await new Promise((resolve) => {
      const up = http.request(
        { host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers },
        (ures) => {
          if (ures.statusCode === 407 && !retried) {
            ures.resume();
            this.def.provider.reportFailure?.(upstream, new Error('407'));
            resolve(this._forward(req, res, true));
            return;
          }
          res.writeHead(ures.statusCode, ures.headers);
          ures.on('data', (c) => { this.usage.bytesDown += c.length; });
          ures.pipe(res);
          ures.on('end', () => {
            this.stats.httpOk++;
            this.onEvent('http-done');
            resolve(true);
          });
          ures.on('error', () => resolve(false));
        },
      );
      up.on('error', (e) => {
        this.def.provider.reportFailure?.(upstream, e);
        if (!res.headersSent) res.writeHead(502).end(`upstream error: ${e.message}`);
        else res.destroy();
        this.stats.httpFail++;
        resolve(false);
      });
      if (body.length) up.write(body);
      up.end();
    });
  }

  _readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.concat(chunks)));
    });
  }

  _reject(sock, code, msg) {
    if (sock.destroyed) return;
    sock.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
    sock.destroy();
  }
}

module.exports = { ProxyServer };
