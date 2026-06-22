const { supabase } = require('../config/database');
const paymentService = require('../services/paymentService');
const deliveryService = require('../services/deliveryService');
const { applicationLogger, errorsLogger } = require('../config/logger');

class UpsellWorker {
  constructor() {
    this.interval = null;
    this.running = false;
  }

  start(intervalMs = 180000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Upsell worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.processTimedOutUpsells();
      } catch (err) {
        errorsLogger.error('Upsell worker error', { error: err.message });
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Upsell worker stopped');
  }

  async processTimedOutUpsells() {
    try {
      const now = new Date().toISOString();

      // Find UPSELL_PENDING sessions whose real offer timer expired.
      const { data: timedOutSessions, error } = await supabase
        .from('payment_sessions')
        .select('id, customer_email, upsell_status, upsell_expires_at')
        .eq('status', 'UPSELL_PENDING')
        .lt('upsell_expires_at', now);

      if (error) throw error;

      if (timedOutSessions && timedOutSessions.length > 0) {
        applicationLogger.info('Processing timed out upsells', { count: timedOutSessions.length });

        for (const session of timedOutSessions) {
          try {
            await paymentService.transitionState(session.id, 'UPSELL_DECLINED', {
              upsell_status: 'timed_out',
              upsell_resolved_at: now,
            });

            await deliveryService.getOrCreateDelivery(session.id);

            applicationLogger.info('Upsell timed out', { sessionId: session.id });
          } catch (err) {
            errorsLogger.error('Failed to process timed out upsell', {
              sessionId: session.id,
              error: err.message,
            });
          }
        }
      }

      return timedOutSessions?.length || 0;
    } catch (err) {
      errorsLogger.error('Process timed out upsells failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = new UpsellWorker();
