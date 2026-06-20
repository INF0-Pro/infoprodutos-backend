const { supabase } = require('../config/database');
const { applicationLogger, errorsLogger } = require('../config/logger');

class ExpirationWorker {
  constructor() {
    this.interval = null;
    this.running = false;
  }

  start(intervalMs = 60000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Expiration worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.expireOldSessions();
      } catch (err) {
        errorsLogger.error('Expiration worker error', { error: err.message });
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Expiration worker stopped');
  }

  async expireOldSessions() {
    try {
      const now = new Date().toISOString();

      // Find all sessions that have expired
      const { data: expiredSessions, error } = await supabase
        .from('payment_sessions')
        .select('id, status, expires_at')
        .lt('expires_at', now)
        .in('status', [
          'CREATED',
          'CHECKOUT_OPEN',
          'PAYMENT_SESSION_CREATED',
          'WAITING_PAYMENT',
          'UPSELL_PENDING',
        ]);

      if (error) throw error;

      if (expiredSessions && expiredSessions.length > 0) {
        const ids = expiredSessions.map(s => s.id);

        await supabase
          .from('payment_sessions')
          .update({
            status: 'EXPIRED',
            updated_at: now,
          })
          .in('id', ids);

        applicationLogger.info('Expired old sessions', { count: expiredSessions.length });
      }

      // Also expire old deliveries
      const { data: expiredDeliveries, error: delError } = await supabase
        .from('deliveries')
        .select('id')
        .lt('expires_at', now)
        .eq('status', 'unlocked');

      if (delError) throw delError;

      if (expiredDeliveries && expiredDeliveries.length > 0) {
        const deliveryIds = expiredDeliveries.map(d => d.id);

        await supabase
          .from('deliveries')
          .update({ status: 'expired' })
          .in('id', deliveryIds);

        applicationLogger.info('Expired old deliveries', { count: expiredDeliveries.length });
      }

      return {
        sessions: expiredSessions?.length || 0,
        deliveries: expiredDeliveries?.length || 0,
      };
    } catch (err) {
      errorsLogger.error('Expire old sessions failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = new ExpirationWorker();
