-- Pool Manager Database Schema

CREATE TABLE IF NOT EXISTS devices (
  deviceId TEXT PRIMARY KEY,
  name TEXT DEFAULT 'Device',
  status TEXT DEFAULT 'unknown',  -- online, offline, locked
  lastHeartbeat DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  config TEXT  -- JSON config per device
);

CREATE TABLE IF NOT EXISTS proxies (
  proxyId TEXT PRIMARY KEY,  -- {deviceId}:{allocId}
  deviceId TEXT NOT NULL,
  allocId TEXT,
  localPort INTEGER,
  country TEXT,
  exitIp TEXT,
  health REAL DEFAULT 100,  -- 0-100%
  status TEXT DEFAULT 'unknown',  -- healthy, warning, critical, offline
  requestsTotal INTEGER DEFAULT 0,
  failuresTotal INTEGER DEFAULT 0,
  bytesUp INTEGER DEFAULT 0,
  bytesDown INTEGER DEFAULT 0,
  latency INTEGER DEFAULT 0,
  successRate REAL DEFAULT 100,
  lastCheck DATETIME,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deviceId) REFERENCES devices(deviceId)
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proxyId TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  latency INTEGER,  -- ms
  successRate REAL,  -- 0-100
  bytesUp INTEGER DEFAULT 0,
  bytesDown INTEGER DEFAULT 0,
  FOREIGN KEY (proxyId) REFERENCES proxies(proxyId)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_proxies_device ON proxies(deviceId);
CREATE INDEX IF NOT EXISTS idx_proxies_country ON proxies(country);
CREATE INDEX IF NOT EXISTS idx_proxies_health ON proxies(health);
CREATE INDEX IF NOT EXISTS idx_metrics_proxy ON metrics(proxyId);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
