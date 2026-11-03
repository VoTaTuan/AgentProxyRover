'use strict';

/**
 * Headless test of the MCP surface (no Electron GUI needed).
 *
 *   node tools/mcp-smoke.js          protocol tests with stub tools (no network)
 *   node tools/mcp-smoke.js --live   additionally wires the REAL ProxyManager
 *                                    (hits the backend, registers a device) and
 *                                    exercises get_allocation / list_proxies /
 *                                    get_status. Does NOT bind proxy ports.
 *
 * Usage: BACKEND_URL=http://127.0.0.1:7788/api/v1 node tools/mcp-smoke.js --live
 */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { McpServer } = require('../lib/mcp-server');
const { buildMcpTools } = require('../lib/mcp-tools');

const PORT = 7795;
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

function request(method, pathname, raw, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method,
        agent: false, // fresh connection each call — no stale keep-alive sockets
        headers: {
          'Content-Type': 'application/json',
          ...(raw ? { 'Content-Length': Buffer.byteLength(raw) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(raw);
  });
}

const rpc = (method, params, { id = 1, headers = {} } = {}) =>
  request(
    'POST',
    '/mcp',
    JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }),
    headers,
  );

async function protocolTests() {
  const tools = new Map([
    ['echo', {
      title: 'Echo',
      description: 'echo back',
      inputSchema: { type: 'object', required: ['msg'], properties: { msg: { type: 'string' } } },
      call: async (a) => ({ said: a.msg }),
    }],
    ['boom', {
      description: 'always throws',
      inputSchema: { type: 'object', properties: {} },
      call: async () => { throw new Error('kapow'); },
    }],
  ]);
  const mcp = new McpServer({ name: 'test', version: '0.0.1', port: PORT, tools, log: (m) => console.log(`  [mcp] ${m}`) });
  await mcp.start();
  check('server listening', mcp.info().running);

  const health = await request('GET', '/health');
  const healthBody = JSON.parse(health.body);
  check('GET /health 200 with tools', health.status === 200 && Array.isArray(healthBody.tools) && healthBody.tools.length === 2);

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'smoke', version: '0' } }, { id: 7 });
  const initBody = JSON.parse(init.body);
  check(
    'initialize echoes protocol + serverInfo',
    init.status === 200 && initBody.id === 7 && initBody.result?.protocolVersion === '2025-06-18'
      && initBody.result?.serverInfo?.name === 'test' && !!initBody.result?.capabilities?.tools,
    JSON.stringify(initBody),
  );

  const older = await rpc('initialize', { protocolVersion: '2024-11-05' });
  check('initialize accepts older protocol', JSON.parse(older.body).result?.protocolVersion === '2024-11-05');

  const notif = await rpc('notifications/initialized', undefined, { id: null });
  check('notification -> 202 empty', notif.status === 202 && notif.body === '');

  const list = await rpc('tools/list');
  const listBody = JSON.parse(list.body);
  check(
    'tools/list describes both tools',
    Array.isArray(listBody.result?.tools) && listBody.result.tools.length === 2
      && listBody.result.tools[0].name === 'echo' && !!listBody.result.tools[0].description,
  );

  const call = await rpc('tools/call', { name: 'echo', arguments: { msg: 'hi' } });
  const callBody = JSON.parse(call.body);
  const structured = callBody.result?.structuredContent;
  check(
    'tools/call returns content + structuredContent',
    call.status === 200 && callBody.result?.isError === false && structured?.said === 'hi'
      && JSON.parse(callBody.result.content[0].text).said === 'hi',
  );

  const boom = await rpc('tools/call', { name: 'boom', arguments: {} });
  const boomBody = JSON.parse(boom.body);
  check(
    'tool failure -> isError result (HTTP 200, not protocol error)',
    boom.status === 200 && boomBody.result?.isError === true && boomBody.result.content[0].text.includes('kapow'),
  );

  const missing = await rpc('tools/call', { name: 'echo', arguments: {} });
  check('missing required arg -> -32602', JSON.parse(missing.body).error?.code === -32602);

  const unknownTool = await rpc('tools/call', { name: 'nope', arguments: {} });
  check('unknown tool -> -32602', JSON.parse(unknownTool.body).error?.code === -32602);

  const unknownMethod = await rpc('resources/read', { uri: 'file:///x' });
  check('unknown method -> -32601', JSON.parse(unknownMethod.body).error?.code === -32601);

  const emptyRes = await rpc('prompts/list');
  check('prompts/list -> empty (compat)', Array.isArray(JSON.parse(emptyRes.body).result?.prompts));

  const badJson = await request('POST', '/mcp', '{oops', {});
  check('parse error -> 400 / -32700', badJson.status === 400 && JSON.parse(badJson.body).error?.code === -32700);

  const evilHost = await rpc('ping', undefined, { headers: { Host: 'evil.example:7795' } });
  check('foreign Host header -> 403', evilHost.status === 403);

  const evilOrigin = await rpc('ping', undefined, { headers: { Origin: 'https://evil.example' } });
  check('foreign Origin header -> 403', evilOrigin.status === 403);

  const notFound = await request('POST', '/other', '{}');
  check('wrong path -> 404', notFound.status === 404);

  const notAllowed = await request('GET', '/mcp');
  check('GET /mcp -> 405', notAllowed.status === 405 && notAllowed.headers.allow === 'POST');

  await mcp.stop();
  check('server stopped', !mcp.info().running);
}

async function liveTests() {
  console.log('\n-- live: real ProxyManager (network, device registration) --');
  const { ProxyManager } = require('../lib/proxy-manager');
  const stateDir = path.join(os.tmpdir(), `apr-mcp-smoke-${Date.now()}`);
  const manager = new ProxyManager(stateDir);
  const live = new McpServer({
    name: 'agentproxy',
    version: '0.0.0-smoke',
    port: PORT,
    tools: buildMcpTools(manager),
    log: (m) => console.log(`  [mcp] ${m}`),
  });
  await live.start();

  const alloc = JSON.parse((await rpc('tools/call', { name: 'get_allocation', arguments: {} })).body);
  const a = alloc.result?.structuredContent;
  check('get_allocation ok', alloc.result?.isError === false && (a?.total ?? 0) >= 1, alloc.body);
  if (a) console.log(`  allocation: ${a.total} proxies @ ${a.publicIp} (${[...new Set(a.items.map((i) => i.country))].join(', ')})`);

  const st = JSON.parse((await rpc('tools/call', { name: 'get_status', arguments: {} })).body);
  const s = st.result?.structuredContent;
  check('get_status ok (not running)', st.result?.isError === false && s?.running === false && s?.allocationSize >= 1);

  const lp = JSON.parse((await rpc('tools/call', { name: 'list_proxies', arguments: {} })).body);
  const p = lp.result?.structuredContent;
  check('list_proxies while stopped -> running:false + hint', p?.running === false && typeof p?.hint === 'string');

  const us = JSON.parse((await rpc('tools/call', { name: 'list_proxies', arguments: { country: 'US' } })).body);
  check('list_proxies country filter works while stopped', us.result?.structuredContent?.count === 0);

  console.log('  (connect/disconnect tools are protocol-tested above; they bind real ports — skipped here)');
  await live.stop();
}

async function main() {
  await protocolTests();
  if (process.argv.includes('--live')) await liveTests();
  console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke FAILED:', e);
  process.exit(1);
});
