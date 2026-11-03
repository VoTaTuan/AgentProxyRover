'use strict';

/**
 * Live demo: backend-driven revoke kills tunnels within one poll interval,
 * blocks new connections with 503, and restores on command.
 *
 * Usage: node tools/revoke-demo.js
 */

const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ProxyManager } = require('../lib/proxy-manager');

function tunnelThrough(port, target) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = '';
    const done = (r) => resolve({ sock, ...r });
    sock.on('connect', () => sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n')) done({ status: buf.split('\r\n')[0] });
    });
    sock.on('error', (e) => done({ status: `ERR ${e.code}`, error: true }));
    setTimeout(() => done({ status: 'HELD-OPEN' }), 4000);
  });
}

async function main() {
  const mgr = new ProxyManager(path.join(os.tmpdir(), `apr-mgr-demo-${Date.now()}`), () => {});
  mgr.saveSettings({ backendUrl: 'http://127.0.0.1:7788', bindIp: '127.0.0.1', portStart: 8960, portCount: 2 });
  const state = await mgr.start();
  const item0 = state.proxies[0];
  console.log('engine A:', item0.listen, item0.country, item0.exitHost, '| id:', mgr.allocation.items[0].id);

  // 1. open two held tunnels
  const t1 = await tunnelThrough(8960, 'example.com:443');
  const t2 = await tunnelThrough(8960, 'example.com:443');
  console.log('tunnel1:', t1.status, '| tunnel2:', t2.status);
  await new Promise((r) => setTimeout(r, 500));
  const srv0 = mgr.servers[0];
  console.log('active sockets before revoke:', srv0.sockets.size);

  // 2. operator revokes this proxy
  const itemId = mgr.allocation.items[0].id;
  const t0ms = Date.now();
  const r = await fetch(`http://127.0.0.1:7788/v1/admin/item/${itemId}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'demo-admin-key' },
    body: JSON.stringify({ revoke: true }),
  });
  console.log('admin revoke HTTP:', r.status);

  // 3. manager polls (5s) — engine must kill the tunnels itself
  let killedAt = null;
  for (let t = 0; t <= 9000; t += 250) {
    await new Promise((rr) => setTimeout(rr, 250));
    if (srv0.sockets.size === 0 && srv0.revoked) {
      killedAt = Date.now() - t0ms;
      break;
    }
  }
  console.log(killedAt ? `tunnels killed after ${killedAt}ms, engine revoked=true` : 'NOT KILLED!');

  // 4. new tunnel gets 503
  const blocked = await tunnelThrough(8960, 'example.com:443');
  console.log('new tunnel while revoked:', blocked.status);

  // 5. restore
  await fetch(`http://127.0.0.1:7788/v1/admin/item/${itemId}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'demo-admin-key' },
    body: JSON.stringify({ revoke: false }),
  });
  for (let t = 0; t <= 9000; t += 250) {
    await new Promise((rr) => setTimeout(rr, 250));
    if (!srv0.revoked) break;
  }
  const again = await tunnelThrough(8960, 'example.com:443');
  console.log(
    'tunnel after restore:',
    again.status.startsWith('HTTP') ? `${again.status}  <- WORKING AGAIN` : again.status,
  );
  t1.sock.destroy();
  t2.sock.destroy();
  again.sock.destroy();
  await mgr.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.stack || e.message);
  process.exit(1);
});
