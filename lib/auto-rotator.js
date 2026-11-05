'use strict';

/**
 * Auto-Rotator - Automatically rotate proxies based on health metrics.
 * Respects Shiplo rotation quota (20 per 20 minutes).
 */
class AutoRotator {
  constructor({ failureThreshold = 3, timeWindow = 300000, strategy = 'manual', latencyThreshold = 500 } = {}) {
    this.failureThreshold = failureThreshold; // rotate after N failures
    this.timeWindow = timeWindow; // time window to count failures (5 min default)
    this.strategy = strategy; // manual, auto-fail, auto-slow, auto-both
    this.latencyThreshold = latencyThreshold; // ms (for auto-slow)
    this.rotationCandidates = new Set(); // proxies queued for rotation
    this.rotationInProgress = new Set(); // proxies being rotated
    this.lastRotationTimes = {}; // {[itemId]: timestamp}
    this.onRotationNeeded = null; // callback: (itemId) => Promise
  }

  /**
   * Check if proxy should be rotated based on strategy.
   * @param {Object} metrics - from HealthMonitor.getMetrics()
   * @returns {boolean} true if should rotate
   */
  shouldRotate(metrics) {
    if (!metrics || this.strategy === 'manual') return false;
    if (this.rotationInProgress.has(metrics.itemId)) return false; // already rotating

    const recentFailures = metrics.failures.filter(
      (t) => Date.now() - t < this.timeWindow
    ).length;
    const hasTooManyFailures = recentFailures >= this.failureThreshold;
    const hasHighLatency = metrics.latency && metrics.latency > this.latencyThreshold;

    switch (this.strategy) {
      case 'auto-fail':
        return hasTooManyFailures;
      case 'auto-slow':
        return hasHighLatency;
      case 'auto-both':
        return hasTooManyFailures || hasHighLatency;
      default:
        return false;
    }
  }

  /**
   * Queue a proxy for rotation (respects quota).
   * @param {string} itemId
   * @param {Object} quota - {left, limit} from Shiplo
   * @returns {boolean} true if queued, false if quota exhausted
   */
  queueRotation(itemId, quota) {
    if (!quota || quota.left <= 0) {
      console.warn(`[auto-rotator] No rotation quota left for ${itemId}`);
      return false;
    }

    this.rotationCandidates.add(itemId);
    return true;
  }

  /**
   * Execute rotation for a proxy (calls callback).
   * @param {string} itemId
   * @returns {Promise<boolean>} true if rotated, false if failed
   */
  async rotateProxy(itemId) {
    if (this.rotationInProgress.has(itemId)) return false;

    this.rotationInProgress.add(itemId);
    this.rotationCandidates.delete(itemId);

    try {
      if (!this.onRotationNeeded) {
        throw new Error('onRotationNeeded callback not set');
      }

      await this.onRotationNeeded(itemId);
      this.lastRotationTimes[itemId] = Date.now();
      return true;
    } catch (e) {
      console.error(`[auto-rotator] Rotation failed for ${itemId}:`, e.message);
      return false;
    } finally {
      this.rotationInProgress.delete(itemId);
    }
  }

  /**
   * Process all rotation candidates (async, non-blocking).
   * Respects quota by not rotating too many at once.
   * @param {Object} quota - {left, limit} from Shiplo
   * @returns {Promise<number>} count of rotations performed
   */
  async processQueue(quota) {
    if (!quota || quota.left <= 0) {
      return 0; // no quota
    }

    let rotated = 0;
    const candidates = Array.from(this.rotationCandidates);

    for (const itemId of candidates) {
      if (quota.left <= 0) break; // stop if quota exhausted

      const success = await this.rotateProxy(itemId);
      if (success) {
        rotated++;
        quota.left--; // decrement locally (backend will confirm)
      }
    }

    return rotated;
  }

  /**
   * Get status of auto-rotator.
   * @returns {{queued: number, inProgress: number}}
   */
  getStatus() {
    return {
      queued: this.rotationCandidates.size,
      inProgress: this.rotationInProgress.size,
    };
  }

  /**
   * Reset state for a proxy (e.g., after successful rotation).
   * @param {string} itemId
   */
  reset(itemId) {
    this.rotationCandidates.delete(itemId);
    this.rotationInProgress.delete(itemId);
  }
}

module.exports = { AutoRotator };
