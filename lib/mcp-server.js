'use strict';

const http = require('node:http');

const SUPPORTED_PROTOCOL = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL = '2025-06-18';
const MAX_BODY = 2 * 1024 * 1024;

class McpError extends Error {
  constructor(message, code = -32601) {
    super(message);
    this.code = code;
  }
}

/**
 * MCP (Model Context Protocol) server — Streamable HTTP transport, stateless
 * mode. Zero dependency: one http.Server answering JSON-RPC on POST /mcp
 * with a single application/json response per request (notifications -> 202).
 *
 * Local-only by design: binds 127.0.0.1, rejects foreign Host/Origin headers
 * (DNS-rebinding guard) and never sends CORS headers, so web pages in a
 * browser cannot reach it. Set `token` to additionally require
 * `Authorization: Bearer <token>` on every call.
 */
class McpServer {
  constructor({ name, version, host = '127.0.0.1', port, tools, token = null, instructions = null, log = () => {} }) {
    this.name = name;
    this.version = version;
    this.host = host;
    this.port = port;
    this.tools = tools; // Map name -> { title?, description, inputSchema?, call(args) }
    this.token = token;
    this.instructions = instructions;
    this.log = log;
    this.server = null;
    this.error = null;
  }

  async start() {
    this.error = null;
    if (this.server) return;
    const srv = http.createServer((req, res) => {
      this._route(req, res).catch((e) => {
        this.log(`mcp: request failed: ${e.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal error' }));
        } else {
          res.end();
        }
      });
    });
    srv.on('clientError', (_err, socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(this.port, this.host, resolve);
      });
    } catch (e) {
      this.error = e.message;
      this.log(`mcp: cannot listen on ${this.host}:${this.port} — ${e.message}`);
      return;
    }
    srv.on('error', (e) => this.log(`mcp: ${e.message}`));
    this.server = srv;
    this.log(`mcp: listening on http://${this.host}:${this.port}/mcp`);
  }

  async stop() {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise((r) => srv.close(r));
  }

  /** What the UI (and /health) reports about this server. */
  info() {
    return {
      running: !!this.server,
      url: this.server ? `http://${this.host}:${this.port}/mcp` : null,
      error: this.error,
      tools: [...this.tools.keys()],
    };
  }

  async _route(req, res) {
    const { method, url, headers } = req;
    const hostHeader = String(headers.host ?? '').toLowerCase();
    const okHost = hostHeader === `${this.host}:${this.port}` || hostHeader === `localhost:${this.port}`;
    if (!okHost) return this._json(res, 403, { error: 'forbidden host' });
    const origin = headers.origin ? String(headers.origin) : null;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return this._json(res, 403, { error: 'forbidden origin' });
    }
    if (this.token && String(headers.authorization ?? '') !== `Bearer ${this.token}`) {
      return this._json(res, 401, { error: 'unauthorized' });
    }

    const endpoint = String(url ?? '/').split('?')[0];
    if (method === 'GET' && (endpoint === '/' || endpoint === '/health')) {
      const info = this.info();
      return this._json(res, 200, {
        server: this.name,
        version: this.version,
        transport: 'mcp-streamable-http (stateless)',
        endpoint: info.url,
        tools: info.tools,
      });
    }
    if (endpoint !== '/mcp') return this._json(res, 404, { error: 'not found — the MCP endpoint is POST /mcp' });

    if (method === 'POST') {
      let raw;
      try {
        raw = await this._readBody(req);
      } catch {
        return this._json(res, 413, { error: 'body too large' });
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return this._json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      const handled = Array.isArray(msg)
        ? (await Promise.all(msg.map((m) => this._handle(m)))).filter((r) => r !== null)
        : await this._handle(msg);
      if (handled === null) return this._accepted(res); // notification — no reply body
      return this._json(res, 200, handled);
    }

    // GET /mcp (server-push SSE) and DELETE /mcp (session teardown) belong to
    // sessionful transports; this stateless server accepts POST only.
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed — POST JSON-RPC messages to /mcp' }));
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.removeAllListeners('data');
          req.resume(); // drain the rest, then answer
          return reject(new Error('body too large'));
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /** Handle one JSON-RPC message; returns null for notifications (send 202). */
  async _handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { id, method, params } = msg;
    if (method === undefined) return null; // a response object — nothing pending statelessly
    if (id === undefined || id === null) return null; // notification
    try {
      return { jsonrpc: '2.0', id, result: await this._dispatch(method, params ?? {}) };
    } catch (e) {
      const code = e instanceof McpError ? e.code : -32603;
      return { jsonrpc: '2.0', id, error: { code, message: e.message } };
    }
  }

  async _dispatch(method, params) {
    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
        const protocolVersion = requested && SUPPORTED_PROTOCOL.includes(requested) ? requested : LATEST_PROTOCOL;
        return {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.name, version: this.version },
          ...(this.instructions ? { instructions: this.instructions } : {}),
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [...this.tools.entries()].map(([name, t]) => ({
            name,
            ...(t.title ? { title: t.title } : {}),
            description: t.description,
            inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          })),
        };
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const tool = this.tools.get(name);
        if (!tool) throw new McpError(`Unknown tool: ${name || '(none)'}`, -32602);
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        for (const key of tool.inputSchema?.required ?? []) {
          if (!(key in args)) throw new McpError(`Missing required argument "${key}"`, -32602);
        }
        try {
          const result = await tool.call(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          };
        } catch (e) {
          // Tool failures are RESULTS, not protocol errors (MCP contract).
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      }
      // Nothing else advertised, but answer politely so clients don't choke.
      case 'resources/list':
        return { resources: [] };
      case 'resources/templates/list':
        return { resourceTemplates: [] };
      case 'prompts/list':
        return { prompts: [] };
      default:
        throw new McpError(`Method not found: ${method}`, -32601);
    }
  }

  _json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  }

  _accepted(res) {
    res.writeHead(202);
    res.end();
  }
}

module.exports = { McpServer };
