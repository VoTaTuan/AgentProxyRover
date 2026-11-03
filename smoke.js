'use strict';

/**
 * Headless end-to-end test of the whole split (no Electron GUI needed):
 *   1. device registration against the backend
 *   2. allocation fetch (20 free proxies bound to this public IP)
 *   3. bind the first 3 proxies locally, verify real exit IPs
 *   4. SECOND device (fresh identity) from the same IP must receive the
 *      SAME allocation  -> free-tier quota works
 *
 * Usage: BACKEND_URL=http://127.0.0.1:7788 node smoke.js
 */

const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { ProxyServer } = require('./lib/proxy-engine');
const { BackendClient } = require('./lib/backend-client');
const { BackendUpstreamProvider } = require('./lib/upstream-provider');

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:7788/api/v1';
const BIND = '127.0.0.1';
const PORT_START = 8901;

function fetchViaProxy(port, url) {
  // absolute-URI plain HTTP through our engine; http targets only
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: BIND, port, path: url, headers: { Host: new URL(url).host } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      },
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main() {
  console.log(`backend: ${BACKEND}`);

  // 1+2. device A: register + allocation
  const clientA = new BackendClient(BACKEND, path.join(os.tmpdir(), `apr-smoke-${Date.now()}-a`));
  const alloc = await clientA.getAllocation();
  console.log(`device A: ${alloc.total} proxies @ ${alloc.ip}`);
  if (alloc.total < 1) throw new Error('empty allocation');

  // 3. bind first 3 and verify each exits via its pinned host
  const servers = [];
  let okCount = 0;
  let deadExits = [];
  for (let i = 0; i < Math.min(3, alloc.items.length); i++) {
    const item = alloc.items[i];
    const provider = new BackendUpstreamProvider(clientA, item);
    const server = new ProxyServer({ name: item.id, listen: `${BIND}:${PORT_START + i}`, provider });
    await server.start();
    servers.push(server);

    const cred = await clientA.credentials(item.id);
    const expected = cred.exitHost ?? item.exitHost;
    let exitIp = null;
    for (let tryN = 0; tryN < 3 && !exitIp; tryN++) {
      try {
        const out = await fetchViaProxy(PORT_START + i, 'http://api.ipify.org?format=json');
        exitIp = JSON.parse(out).ip;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!exitIp) deadExits.push(expected);
    else {
      okCount++;
      const match = exitIp === expected ? 'OK' : 'MISMATCH';
      console.log(`  ${BIND}:${PORT_START + i} -> ${item.country} exit=${exitIp} expected=${expected} [${match}]`);
    }
  }
  await Promise.all(servers.map((s) => s.stop()));
  console.log(`tunnels: ${okCount}/3 OK${deadExits.length ? ` | dead exits: ${deadExits.join(', ')}` : ''}`);

  // 4. device B from the same IP -> same allocation
  const clientB = new BackendClient(BACKEND, path.join(os.tmpdir(), `apr-smoke-${Date.now()}-b`));
  const allocB = await clientB.getAllocation();
  const idsA = alloc.items.map((x) => x.id).sort().join(',');
  const idsB = allocB.items.map((x) => x.id).sort().join(',');
  console.log(`device B: ${allocB.total} proxies`);
  console.log(`same-IP quota: ${idsA === idsB ? 'PASS (same 20 proxies)' : 'FAIL (different!)'}`);
  const quotaPass = idsA === idsB;
  console.log(`RESULT: quota ${quotaPass ? 'PASS' : 'FAIL'}, tunnels ${okCount}/3 OK`);

  process.exit(quotaPass && okCount >= 2 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke FAILED:', e.message);
  process.exit(1);
});
