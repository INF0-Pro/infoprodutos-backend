const { supabase } = require('../config/database');
const deliveryService = require('../services/deliveryService');
const { applicationLogger, errorsLogger } = require('../config/logger');

class DeliveryWorker {
  constructor() {
    this.interval = null;
    this.running = false;
  }

  start(intervalMs = 120000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Delivery worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.processPendingDeliveries();
      } catch (err) {
        errorsLogger.error('Delivery worker error', { error: err.message });
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Delivery worker stopped');
  }

  async processPendingDeliveries() {
    try {
      // Find sessions that are PAYMENT_CONFIRMED, UPSELL_ACCEPTED, or UPSELL_DECLINED
      // but don't have a delivery yet
      const { data: sessions, error } = await supabase
        .from('payment_sessions')
        .select('*')
        .in('status', ['PAYMENT_CONFIRMED', 'UPSELL_ACCEPTED', 'UPSELL_DECLINED'])
        .is('delivery_unlocked_at', null)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) throw error;

      if (sessions && sessions.length > 0) {
        applicationLogger.info('Processing pending deliveries', { count: sessions.length });

        for (const session of sessions) {
          try {
            await deliveryService.unlockDelivery(session.id);
          } catch (err) {
            errorsLogger.error('Failed to unlock delivery for session', {
              sessionId: session.id,
              error: err.message,
            });
          }
        }
      }
    } catch (err) {
      errorsLogger.error('Process pending deliveries failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = new DeliveryWorker();
