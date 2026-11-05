'use strict';

/**
 * Device Registry - Track all connected devices
 */
class DeviceRegistry {
  constructor(db) {
    this.db = db;
    this.devices = new Map(); // in-memory cache
  }

  /**
   * Register a new device
   */
  async register(deviceId, name = 'Device') {
    const device = {
      deviceId,
      name,
      status: 'online',
      lastHeartbeat: new Date(),
      createdAt: new Date(),
    };

    await this.db.run(
      `INSERT OR REPLACE INTO devices (deviceId, name, status, lastHeartbeat, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [deviceId, name, device.status, device.lastHeartbeat.toISOString(), device.createdAt.toISOString()]
    );

    this.devices.set(deviceId, device);
    return device;
  }

  /**
   * Update device heartbeat
   */
  async heartbeat(deviceId) {
    const now = new Date();
    await this.db.run(
      `UPDATE devices SET status = 'online', lastHeartbeat = ? WHERE deviceId = ?`,
      [now.toISOString(), deviceId]
    );

    const device = this.devices.get(deviceId);
    if (device) {
      device.status = 'online';
      device.lastHeartbeat = now;
    }

    return device;
  }

  /**
   * Get device by ID
   */
  async getDevice(deviceId) {
    // Check cache first
    if (this.devices.has(deviceId)) {
      return this.devices.get(deviceId);
    }

    const device = await this.db.get(
      `SELECT * FROM devices WHERE deviceId = ?`,
      [deviceId]
    );

    if (device) {
      this.devices.set(deviceId, device);
    }

    return device || null;
  }

  /**
   * Get all devices (with auto-offline timeout: 60s)
   */
  async getAllDevices() {
    const devices = await this.db.all(`SELECT * FROM devices ORDER BY lastHeartbeat DESC`);

    // Auto-mark offline if no heartbeat for 60 seconds
    const timeoutMs = 60000;
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();

    for (const device of devices) {
      if (device.status === 'online' && device.lastHeartbeat < cutoff) {
        await this.setStatus(device.deviceId, 'offline');
        device.status = 'offline';
      }
    }

    return devices;
  }

  /**
   * Get online devices
   */
  async getOnlineDevices() {
    const cutoff = new Date(Date.now() - 2 * 60000); // 2 min timeout
    const devices = await this.db.all(
      `SELECT * FROM devices WHERE status = 'online' AND lastHeartbeat > ? ORDER BY lastHeartbeat DESC`,
      [cutoff.toISOString()]
    );
    return devices;
  }

  /**
   * Update device status
   */
  async setStatus(deviceId, status) {
    await this.db.run(
      `UPDATE devices SET status = ? WHERE deviceId = ?`,
      [status, deviceId]
    );

    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
    }
  }

  /**
   * Clear old devices (offline for > 1 hour)
   */
  async cleanup(maxAgeMs = 3600000) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    await this.db.run(
      `DELETE FROM devices WHERE status = 'offline' AND lastHeartbeat < ?`,
      [cutoff]
    );
  }
}

module.exports = { DeviceRegistry };
