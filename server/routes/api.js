'use strict';

const express = require('express');

/**
 * API Routes for Pool Manager
 */
function createApiRouter(registry, inventory, balancer) {
  const router = express.Router();

  // Health check
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Device management
  router.post('/devices/register', async (req, res) => {
    try {
      const { deviceId, name } = req.body;
      if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

      const device = await registry.register(deviceId, name);
      res.json({ ok: true, device });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/devices/heartbeat', async (req, res) => {
    try {
      const { deviceId, proxies } = req.body;
      if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

      // Update device heartbeat
      await registry.heartbeat(deviceId);

      // Sync proxies
      if (Array.isArray(proxies)) {
        await inventory.syncProxies(deviceId, proxies);
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/devices', async (req, res) => {
    try {
      const devices = await registry.getAllDevices();
      res.json({ devices });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/devices/online', async (req, res) => {
    try {
      const devices = await registry.getOnlineDevices();
      res.json({ devices });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/devices/:id', async (req, res) => {
    try {
      const device = await registry.getDevice(req.params.id);
      if (!device) return res.status(404).json({ error: 'Device not found' });

      const proxies = await inventory.getProxiesByDevice(device.deviceId);
      res.json({ device, proxies });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Proxy management
  router.get('/proxies', async (req, res) => {
    try {
      const country = req.query.country?.toUpperCase();
      let proxies;

      if (country) {
        proxies = await inventory.getProxiesByCountry(country);
      } else {
        proxies = await inventory.getAllProxies();
      }

      res.json({ proxies, count: proxies.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/proxies/select', async (req, res) => {
    try {
      const { strategy = 'bestHealth', country } = req.body;
      const proxy = await balancer.selectProxy({ strategy, country });

      res.json({ proxy });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/proxies/countries', async (req, res) => {
    try {
      const countries = await balancer.getCountries();
      const stats = await balancer.getCountryStats();

      res.json({ countries, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/proxies/:id', async (req, res) => {
    try {
      const proxy = await inventory.getProxy(req.params.id);
      if (!proxy) return res.status(404).json({ error: 'Proxy not found' });

      const stats = await inventory.getProxyStats(proxy.proxyId);
      res.json({ proxy, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/proxies/:id/metrics', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const metrics = await inventory.getMetrics(req.params.id, limit);

      res.json({ metrics, count: metrics.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Metrics
  router.post('/metrics', async (req, res) => {
    try {
      const { proxyId, latency, successRate, bytesUp, bytesDown } = req.body;
      if (!proxyId) return res.status(400).json({ error: 'proxyId required' });

      await inventory.recordMetric(proxyId, latency, successRate, bytesUp || 0, bytesDown || 0);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Stats
  router.get('/stats', async (req, res) => {
    try {
      const devices = await registry.getAllDevices();
      const proxies = await inventory.getAllProxies();
      const countries = await balancer.getCountries();

      const stats = {
        devices: devices.length,
        online: devices.filter(d => d.status === 'online').length,
        proxies: proxies.length,
        healthy: proxies.filter(p => p.status === 'online').length,
        countries: countries.length,
        avgHealth: Math.round(proxies.reduce((sum, p) => sum + (p.health || 0), 0) / proxies.length || 0),
      };

      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createApiRouter };
