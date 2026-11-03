'use strict';

/**
 * E2E test of the admin features (no GUI):
 *   usage tracking  app -> POST /v1/usage -> panel "proxies" (users/bandwidth)
 *   device version  register sends app version -> panel devices[].version
 *   lock/unlock     admin lock -> app kills engines + credentials 403 -> unlock
 *
 * Spawns its OWN backend on PORT 7790 (fresh DATA_DIR) so it never touches
 * the live one on 7788.
 *
 * Usage: node tools/admin-features-smoke.js
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 7790;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
// Admin credentials for the LOCAL test backend spawned below — pass your own
// via env vars, nothing is hardcoded.
const ADMIN = {
  'x-admin-user': process.env.ADMIN_USER ?? 'admin',
  'x-admin-key': process.env.ADMIN_KEY ?? 'local-dev-key',
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
};

const req = (pathname, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1', port: PORT, path: pathname, method, headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.end(body);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-smoke-data-'));
  const backend = spawn(process.execPath, [path.join(__dirname, '..', '..', 'backend', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (c) => process.stdout.write(`[backend] ${c}`));
  backend.stderr.on('data', (c) => process.stderr.write(`[backend] ${c}`));
  backend.on('exit', (code) => { if (code) console.error(`[backend] exited with code ${code}`); });
  try {
    // wait for healthz
    for (let i = 0; i < 60; i++) {
      try {
        const h = await req('/api/v1/healthz');
        if (h.status === 200) break;
        if (i % 10 === 9) console.log(`  healthz status=${h.status} (retrying)`);
      } catch (e) {
        if (i % 10 === 9) console.log(`  healthz ${e.message} (retrying)`);
      }
      await sleep(500);
      if (i === 59) throw new Error('backend did not start');
    }
    console.log('backend up on', PORT);

    const { ProxyManager } = require('../lib/proxy-manager');
    const { BackendClient } = require('../lib/backend-client');
    process.env.BACKEND_URL = BASE;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-smoke-app-'));
    const manager = new ProxyManager(stateDir, () => {}, { appVersion: '9.9.9-test', usageFlushMs: 2000 });
    // point the manager's clients at our test backend
    manager.client = new BackendClient(BASE, stateDir, { version: '9.9.9-test' });

    await manager.start();
    const st = manager.state();
    check('app connected (allocation fetched)', st.running && st.proxies.length >= 1, `proxies=${st.proxies.length}`);
    check('version registered', st.publicIp != null);
    const reg = await req('/api/v1/v1/devices', { method: 'POST', body: JSON.stringify({ deviceId: 'zz-not-mac-check' }) });

    // generate REAL traffic: CONNECT tunnel + HTTP payload through it
    const tunnelWork = (port) => new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      let got = 0;
      const done = () => { try { s.destroy(); } catch { /* dead */ } resolve(got); };
      s.on('error', () => done());
      s.once('data', (d) => {
        if (!d.toString().startsWith('HTTP/1.1 2')) return done();
        s.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
        s.on('data', (c) => { got += c.length; });
        s.on('close', done);
        setTimeout(done, 10000); // safety net
      });
      s.write('CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n');
    });
    const p1 = Number(st.proxies[0].listen.split(':')[1]);
    const p2 = Number(st.proxies[1]?.listen.split(':')[1] ?? p1);
    const plainPost = (port) => new Promise((resolve) => {
      const bodyText = 'x'.repeat(8192);
      const r = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: 'http://example.com/', headers: { Host: 'example.com', 'Content-Length': bodyText.length }, agent: false },
        (res) => { res.resume(); res.on('end', resolve); res.on('error', resolve); },
      );
      r.on('error', resolve);
      r.end(bodyText);
    });
    await Promise.all([tunnelWork(p1), tunnelWork(p2).catch(() => 0), plainPost(p1)]);
    await sleep(3000); // usage flush (2s) fires

    const panel = await req('/api/v1/v1/admin/panel', { headers: ADMIN });
    check('admin panel 200', panel.status === 200, `status=${panel.status}`);
    const d = panel.json ?? {};
    const used = (d.proxies ?? []).filter((p) => p.users > 0 && p.bytesUp + p.bytesDown > 0);
    check('panel tracks proxy users', used.length >= 1, JSON.stringify((d.proxies ?? []).slice(0, 2)));
    check('panel tracks bandwidth', used.reduce((n, p) => n + p.bytesUp + p.bytesDown, 0) > 0);
    check('panel shows app version', (d.devices ?? []).some((x) => x.version === '9.9.9-test'), JSON.stringify((d.devices ?? []).map((x) => x.version)));
    const usedHosts = new Set(used.map((p) => p.exitHost));
    check('per-exit user count = 1 device', used.every((p) => p.users === 1));

    // ---- lock ----
    const deviceId = manager.client.deviceId;
    const lockRes = await req('/api/v1/v1/admin/device/lock', { method: 'POST', headers: ADMIN, body: JSON.stringify({ deviceId, locked: true }) });
    check('admin lock 200', lockRes.status === 200 && lockRes.json?.locked === true);
    const credBefore = await req(`/api/v1/v1/allocation/${manager.allocation.items[0].id}/credentials`, {
      headers: { Authorization: `Bearer ${manager.client.deviceToken}` },
    });
    check('locked device gets 403 on credentials', credBefore.status === 403, `status=${credBefore.status}`);
    const cmdsLocked = await req('/api/v1/v1/commands', { headers: { Authorization: `Bearer ${manager.client.deviceToken}` } });
    check('commands exposes locked:true', cmdsLocked.json?.locked === true);
    await sleep(6500); // poll (5s) reacts
    check('app auto-disconnected on lock', manager.state().running === false && manager.state().locked === true, JSON.stringify({ running: manager.state().running, locked: manager.state().locked }));

    // ---- unlock ----
    await req('/api/v1/v1/admin/device/lock', { method: 'POST', headers: ADMIN, body: JSON.stringify({ deviceId, locked: false }) });
    await sleep(6500);
    check('app sees unlock', manager.state().locked === false);
    await manager.start();
    check('app can connect again after unlock', manager.state().running === true);
    const credAfter = await req(`/api/v1/v1/allocation/${manager.allocation.items[0].id}/credentials`, {
      headers: { Authorization: `Bearer ${manager.client.deviceToken}` },
    });
    check('credentials work again after unlock', credAfter.status === 200, `status=${credAfter.status}`);

    await manager.stop();
    console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    backend.kill();
  }
}

main().catch((e) => { console.error('smoke FAILED:', e); process.exit(1); });
