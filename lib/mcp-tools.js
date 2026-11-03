'use strict';

/**
 * MCP tools exposed to local AI agents, built around a ProxyManager.
 * Kept out of main.js so headless tests can exercise the exact same surface.
 */
function buildMcpTools(manager) {
  const sameCountry = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

  return new Map([
    ['get_status', {
      title: 'Get app status',
      description:
        'Overall AgentProxy app status: whether proxy servers are running, machine public IP, ' +
        'port settings, allocation size and the local MCP endpoint.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        const s = manager.state();
        return {
          running: s.running,
          publicIp: s.publicIp ?? null,
          settings: { bindIp: s.bindIp, portStart: s.portStart, portCount: s.portCount, mcpPort: s.mcpPort },
          proxiesRunning: s.proxies.length,
          allocationSize: s.allocation?.items?.length ?? null,
          resetQuota: s.quota ?? null, // {limit, used, left, windowMs, nextResetAt, totalResets}
        };
      },
    }],
    ['list_proxies', {
      title: 'List local proxies',
      description:
        'List the local HTTP proxy endpoints currently bound by the app: listen address, exit ' +
        'country/host, revoked flag, live connections and per-type request stats (connectOk/connectFail ' +
        'for HTTPS tunnels, httpOk/httpFail for plain HTTP). Each endpoint is a plain ' +
        'HTTP proxy usable directly (e.g. curl -x http://127.0.0.1:8801 https://api.ipify.org) — no ' +
        'local auth needed, upstream credentials are handled internally. Returns running:false with ' +
        'a hint when the app is disconnected.',
      inputSchema: {
        type: 'object',
        properties: {
          country: { type: 'string', description: 'Optional exit-country filter (ISO code, e.g. "US").' },
        },
      },
      call: async (args) => {
        const s = manager.state();
        let proxies = s.proxies ?? [];
        if (args.country) proxies = proxies.filter((p) => sameCountry(p.country, args.country));
        return {
          running: s.running,
          publicIp: s.publicIp ?? null,
          count: proxies.length,
          resetQuota: s.quota ?? null,
          proxies: proxies.map((p) => ({
            proxy: p.listen,
            itemId: p.itemId ?? null,
            country: p.country ?? null,
            exitHost: p.exitHost ?? null,
            revoked: !!p.revoked,
            activeConnections: p.active ?? 0,
            stats: {
              connectOk: p.stats?.connectOk ?? 0, // HTTPS tunnels (CONNECT)
              connectFail: p.stats?.connectFail ?? 0,
              httpOk: p.stats?.httpOk ?? 0, // plain HTTP (absolute-URI)
              httpFail: p.stats?.httpFail ?? 0,
            },
            usage: {
              requests: p.usage?.requests ?? 0,
              bytesUp: p.usage?.bytesUp ?? 0,
              bytesDown: p.usage?.bytesDown ?? 0,
            },
          })),
          ...(s.running
            ? {}
            : {
                hint: 'Proxies are not running — call the "connect" tool (or press Connect in the app), ' +
                  'or use "get_allocation" to see the assigned proxy list without starting anything.',
              }),
        };
      },
    }],
    ['get_allocation', {
      title: 'Get allocated proxies',
      description:
        'Fetch (or refresh) the proxy allocation bound to this machine\'s public IP — up to 20 exits ' +
        'with id/country/exit host — straight from the backend WITHOUT starting local proxy servers. ' +
        'This is the same list the app binds when connecting.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        const s = await manager.fetchAllocation();
        return {
          publicIp: s.publicIp ?? null,
          total: s.allocation?.items?.length ?? 0,
          items: (s.allocation?.items ?? []).map((it) => ({
            id: it.id,
            country: it.country,
            exitHost: it.exitHost,
            exitPort: it.exitPort,
          })),
          resetQuota: s.quota ?? null,
        };
      },
    }],
    ['connect', {
      title: 'Connect proxies',
      description:
        'Start the local proxy servers: binds up to portCount local ports mapped 1:1 onto the ' +
        'allocation. Equivalent to pressing Connect in the app. Idempotent.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        await manager.start();
        const s = manager.state();
        return { ok: true, running: s.running, proxies: s.proxies.map((p) => p.listen) };
      },
    }],
    ['reset_proxy', {
      title: 'Reset a proxy (new exit IP)',
      description:
        'Rotate one local proxy onto a DIFFERENT exit IP (the local port/address stays the ' +
        'same, only the exit changes; live connections through it are cut). Device-level quota: ' +
        '20 resets per rolling 20-minute window, no carry-over — check resetQuota first (fields ' +
        'left/limit/used/nextResetAt). Returns the new exit and the updated quota.',
      inputSchema: {
        type: 'object',
        required: ['proxy'],
        properties: {
          proxy: { type: 'string', description: 'Local listen address from list_proxies, e.g. "127.0.0.1:8801".' },
        },
      },
      call: async (args) => {
        const result = await manager.rotateByListen(String(args.proxy));
        const s = manager.state();
        return {
          ok: true,
          proxy: args.proxy,
          newExit: { country: result.item.country, host: result.item.exitHost, port: result.item.exitPort },
          resetQuota: s.quota ?? result.quota ?? null,
        };
      },
    }],
    ['disconnect', {
      title: 'Disconnect proxies',
      description: 'Stop all local proxy servers and release the ports. Idempotent.',
      inputSchema: { type: 'object', properties: {} },
      call: async () => {
        const s = await manager.stop();
        return { ok: true, running: s.running, proxies: [] };
      },
    }],
  ]);
}

module.exports = { buildMcpTools };
