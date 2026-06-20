const { supabase } = require('../config/database');
const trackingService = require('../services/trackingService');
const { applicationLogger, errorsLogger } = require('../config/logger');

class TrackingWorker {
  constructor() {
    this.interval = null;
    this.running = false;
  }

  start(intervalMs = 300000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Tracking worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.aggregateStats();
      } catch (err) {
        errorsLogger.error('Tracking worker error', { error: err.message });
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Tracking worker stopped');
  }

  async aggregateStats() {
    try {
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Aggregate funnel stats for the last 24 hours
      const stats = await trackingService.getFunnelStats(startDate, endDate);

      applicationLogger.info('Funnel stats aggregated', {
        total_sessions: stats.total_sessions,
        checkout_conversion: stats.checkout_conversion.toFixed(2) + '%',
        payment_conversion: stats.payment_conversion.toFixed(2) + '%',
        delivery_conversion: stats.delivery_conversion.toFixed(2) + '%',
      });

      return stats;
    } catch (err) {
      errorsLogger.error('Aggregate stats failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = new TrackingWorker();
