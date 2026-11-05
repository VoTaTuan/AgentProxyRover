# Proxy Management System - Setup Guide

## 📋 Overview

Complete proxy management system with 3 layers:
1. **Local Monitoring** - Health check, auto-rotation (desktop app)
2. **Central Backend** - Pool manager, load balancing (Node.js server)
3. **Client Integration** - SDK, auto-proxy selection (for tools)

---

## 🚀 Quick Start

### 1️⃣ Start Desktop App (Layer 1)

```bash
npm install
npm start
```

**Features:**
- Health monitoring with real-time status (🟢🟡🔴)
- Auto-rotation on failures
- Local proxy endpoints: `127.0.0.1:8801-8820`

### 2️⃣ Start Backend Server (Layer 2)

```bash
cd server
npm install
npm start
```

**Server runs:** `http://localhost:3021`

**Features:**
- Device registry & sync
- Proxy inventory (SQLite)
- Load balancing (3 strategies)
- REST API for proxy selection

### 3️⃣ Use Proxy in Your Tool (Layer 3)

```javascript
const { ProxyClient } = require('./client/proxy-client');

// Simple: Select best proxy
const client = new ProxyClient('http://localhost:3021');
const proxy = await client.selectProxy({ strategy: 'bestHealth', country: 'US' });

// Use proxy in your request
const url = `http://127.0.0.1:${proxy.localPort}`;
const response = await fetch(targetUrl); // through proxy
```

---

## 🔧 Configuration

### Desktop App (`settings.json`)

```json
{
  "healthCheckInterval": 60000,         // 30s-5min
  "failureThreshold": 3,                // failures before rotate
  "poolServerUrl": "http://localhost:3000",
  "poolSyncEnabled": true               // device sync
}
```

### Backend Server

```bash
PORT=3000 npm start                     # Custom port
POOL_SYNC_ENABLED=true npm start        # Enable/disable sync
```

---

## 📊 API Reference

### Device Management

```
POST   /api/devices/register            # Register device
POST   /api/devices/heartbeat           # Send heartbeat + proxies
GET    /api/devices                     # List all devices
GET    /api/devices/:id                 # Get device details
```

### Proxy Selection

```
GET    /api/proxies                     # List all proxies
GET    /api/proxies?country=US          # Filter by country
POST   /api/proxies/select              # Select best proxy
       {strategy: "bestHealth", country: "US"}
```

### Monitoring

```
GET    /api/stats                       # Pool statistics
GET    /api/proxies/:id/metrics         # Proxy metrics history
POST   /api/metrics                     # Record metric (usage, latency)
```

---

## 🧪 Testing

### Test Health Monitoring

```bash
npm start
# Open DevTools (F12)
# Watch health column change (🟢→🟡→🔴)
# Block proxy IP to trigger auto-rotation
```

### Test Backend Pool

```bash
# Terminal 1: Backend
cd server && npm start

# Terminal 2: App
npm start

# Terminal 3: API test
curl http://localhost:3021/api/stats
curl http://localhost:3021/api/proxies
curl -X POST http://localhost:3021/api/proxies/select \
  -H "Content-Type: application/json" \
  -d '{"strategy":"bestHealth","country":"US"}'
```

### Test YouTube PoC

```bash
node tools/youtube-poc.js https://api.ipify.org?format=json --strategy bestHealth
```

---

## 🎯 Common Scenarios

### 1. Use Best Health Proxy

```javascript
const proxy = await client.selectProxy({ strategy: 'bestHealth' });
```

### 2. Use Specific Country

```javascript
const proxy = await client.selectProxy({ country: 'US' });
```

### 3. Load Balance

```javascript
const manager = new AdvancedProxyManager();
const proxy = await manager.selectLoadBalanced('US');
```

### 4. Geo-Rotate Every Request

```javascript
const manager = new AdvancedProxyManager();
const proxy = await manager.selectGeoRotated(); // cycles through countries
```

### 5. Auto-Retry with Fallback

```javascript
const httpProxy = new HttpWithProxy();
const response = await httpProxy.fetch(url, {}, { strategy: 'bestHealth' });
// Auto-retries up to 3 times on failure
```

---

## 📈 Monitoring & Debugging

### View Health Status

Desktop app shows:
- 🟢 Healthy (latency < 500ms, success rate > 95%)
- 🟡 Warning (latency 500-2000ms, success rate 70-95%)
- 🔴 Critical (latency > 2000ms, success rate < 70%)

### Check Pool Stats

```bash
curl http://localhost:3000/api/stats
# Returns: {devices: 2, online: 2, proxies: 40, healthy: 38, countries: 15, avgHealth: 92}
```

### View Metrics History

```bash
curl http://localhost:3000/api/proxies/device-id:alloc-123/metrics
# Returns: [{timestamp, latency, successRate, bytesUp, bytesDown}, ...]
```

---

## 🔐 Security Notes

- Local-only binding (127.0.0.1)
- No authentication in development (add Bearer token in production)
- Device ID locked to MAC address (can't copy device.json)
- Quota enforced by Shiplo backend (20 rotations per 20 min)

---

## 🛠️ Troubleshooting

### "No proxies available"
- Check if desktop app is running & connected
- Check pool sync enabled in settings
- Check backend server is running

### Backend can't find devices
- Make sure desktop app is running
- Check `poolSyncEnabled` in settings.json
- Check backend URL matches pool server (default: http://localhost:3000)

### Health check showing 🔴
- Check if proxy IP is actually blocked
- May be temporary DNS issue - wait & retry
- Try manual rotation (⟳ button in UI)

### Requests timing out
- Increase `timeout` in HttpWithProxy options
- Reduce number of concurrent requests
- Check proxy load (high latency)

---

## 📚 Full Documentation

- **Architecture:** See plan file at `.claude/plans/piped-fluttering-lecun.md`
- **API Endpoints:** See `server/routes/api.js`
- **SDK Usage:** See `tools/youtube-poc.js` example
- **Advanced Features:** See `tools/proxy-manager-advanced.js`

---

## 🎉 What's Next?

1. ✅ Phase 1: Local monitoring & auto-rotation
2. ✅ Phase 2: Backend pool manager
3. ✅ Phase 3: Client SDK & integration
4. 📋 Optional: Web dashboard, cloud deployment, advanced analytics

---

**Status: Production Ready** ✅

For issues or feature requests, check the code comments or AGENTPROXY_NOTES.md
