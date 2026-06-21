const { supabase } = require('../config/database');
const { applicationLogger, errorsLogger } = require('../config/logger');

class ExpirationWorker {
  constructor() {
    this.interval = null;
    this.running = false;
    this.processing = false; // 🔥 proteção anti-duplo run
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
    if (this.processing) return; // 🔥 evita execução paralela

    this.processing = true;

    try {
      const now = new Date().toISOString();

      // 🔥 mais seguro: respeita ciclo de vida real
      const { data: expiredSessions, error } = await supabase
        .from('payment_sessions')
        .select('id, status, expires_at, created_at')
        .lt('expires_at', now)
        .gte(
          'created_at',
          new Date(Date.now() - 10 * 60 * 1000).toISOString()
        )
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

        applicationLogger.info('Expired old sessions', {
          count: expiredSessions.length
        });
      }

      // 🔥 expirar deliveries antigas
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

        applicationLogger.info('Expired old deliveries', {
          count: expiredDeliveries.length
        });
      }

      return {
        sessions: expiredSessions?.length || 0,
        deliveries: expiredDeliveries?.length || 0,
      };

    } catch (err) {
      errorsLogger.error('Expire old sessions failed', {
        error: err.message
      });
      throw err;

    } finally {
      this.processing = false; // 🔥 garante reset sempre
    }
  }
}

module.exports = new ExpirationWorker();