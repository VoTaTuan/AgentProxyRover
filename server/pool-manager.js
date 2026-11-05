#!/usr/bin/env node
'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('./db');
const { DeviceRegistry } = require('./device-registry');
const { ProxyInventory } = require('./proxy-inventory');
const { LoadBalancer } = require('./load-balancer');
const { createApiRouter } = require('./routes/api');

const PORT = process.env.PORT || 3021;
const DATA_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'pool.db');

// Logs storage
const logs = [];
const MAX_LOGS = 500;

function addLog(message) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const logEntry = `[${timestamp}] ${message}`;
  logs.push(logEntry);
  if (logs.length > MAX_LOGS) logs.shift();
}

// Intercept console.log
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  addLog(args.join(' '));
};

async function main() {
  try {
    // Ensure data directory exists
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Initialize database
    console.log('[pool-manager] Initializing database...');
    const db = new Database(DB_PATH);
    await db.init();

    // Initialize schema
    const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
    for (const statement of schema.split(';').filter(s => s.trim())) {
      await db.run(statement);
    }
    console.log('[pool-manager] Database initialized');

    // Initialize components
    const registry = new DeviceRegistry(db);
    const inventory = new ProxyInventory(db);
    const balancer = new LoadBalancer(inventory);

    // Create Express app
    const app = express();
    app.use(express.json());

    // CORS headers
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') res.sendStatus(200);
      else next();
    });

    // Request logging
    app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });

    // Serve static files (Dashboard)
    app.use(express.static(path.join(__dirname, 'public')));

    // Logs API endpoints
    app.get('/api/logs', (req, res) => {
      res.json({ logs });
    });

    app.post('/api/logs/clear', (req, res) => {
      logs.length = 0;
      res.json({ ok: true });
    });

    // API routes
    app.use('/api', createApiRouter(registry, inventory, balancer));

    // Health endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    // 404
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error('[error]', err.message);
      res.status(500).json({ error: err.message });
    });

    // Periodic cleanup (hourly)
    setInterval(async () => {
      try {
        await registry.cleanup();
        await inventory.cleanupMetrics();
        console.log('[cleanup] Ran device & metrics cleanup');
      } catch (e) {
        console.error('[cleanup] Error:', e.message);
      }
    }, 3600000);

    // Start server with port fallback
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[pool-manager] Server running on http://127.0.0.1:${PORT}`);
      console.log('[pool-manager] Ready to accept device connections');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port bị dùng, thử port khác
        const altPorts = [3022, 3023, 3024, 3025, 3000];
        let portFound = false;

        for (const altPort of altPorts) {
          try {
            const altServer = app.listen(altPort, '127.0.0.1', () => {
              console.log(`[pool-manager] Port ${PORT} in use, using ${altPort} instead`);
              console.log(`[pool-manager] Server running on http://127.0.0.1:${altPort}`);
              console.log('[pool-manager] Ready to accept device connections');
              portFound = true;
            });
            altServer.on('error', () => {}); // Ignore subsequent errors
            break;
          } catch (e) {
            // Continue to next port
          }
        }

        if (!portFound) {
          console.error('[fatal] All ports in use (3021-3025, 3000)');
          process.exit(1);
        }
      } else {
        throw err;
      }
    });
  } catch (e) {
    console.error('[fatal]', e.message);
    process.exit(1);
  }
}

main();
