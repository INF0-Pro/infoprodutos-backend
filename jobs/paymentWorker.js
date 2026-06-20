const { supabase } = require('../config/database');
const paymentService = require('../services/paymentService');
const { applicationLogger, errorsLogger } = require('../config/logger');

class PaymentWorker {
  constructor() {
    this.interval = null;
    this.running = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  start(intervalMs = 60000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Payment worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.processPendingPayments();
        this.retryCount = 0;
      } catch (err) {
        errorsLogger.error('Payment worker error', { error: err.message });
        this.retryCount++;
        if (this.retryCount >= this.maxRetries) {
          errorsLogger.error('Payment worker max retries reached, stopping');
          this.stop();
        }
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Payment worker stopped');
  }

  async processPendingPayments() {
    try {
      // Get sessions waiting for payment
      const { data: sessions, error } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('status', 'WAITING_PAYMENT')
        .lt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) throw error;

      if (sessions && sessions.length > 0) {
        applicationLogger.info('Processing pending payments', { count: sessions.length });

        for (const session of sessions) {
          try {
            // Check if session has payment data
            if (session.copied_value && session.copied_entity) {
              // Try to process payment
              await paymentService.processPaymentWebhook({
                amount: parseFloat(session.copied_value),
                entity: session.copied_entity,
                reference: session.copied_reference,
                received_at: new Date().toISOString(),
                raw_message: 'Auto-processed by worker',
              });
            }
          } catch (err) {
            errorsLogger.error('Failed to process payment for session', {
              sessionId: session.id,
              error: err.message,
            });
          }
        }
      }
    } catch (err) {
      errorsLogger.error('Process pending payments failed', { error: err.message });
      throw err;
    }
  }

  async recoverSessions() {
    try {
      // Find sessions that were WAITING_PAYMENT before restart
      const { data: sessions, error } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('status', 'WAITING_PAYMENT')
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      applicationLogger.info('Recovering WAITING_PAYMENT sessions', { count: sessions?.length || 0 });

      return sessions || [];
    } catch (err) {
      errorsLogger.error('Recover sessions failed', { error: err.message });
      throw err;
    }
  }

  async processExpiredSessions() {
    try {
      const now = new Date().toISOString();

      // Find expired sessions in active states
      const { data: expiredSessions, error } = await supabase
        .from('payment_sessions')
        .select('id, status')
        .in('status', ['WAITING_PAYMENT', 'PAYMENT_SESSION_CREATED', 'CHECKOUT_OPEN'])
        .lt('expires_at', now);

      if (error) throw error;

      if (expiredSessions && expiredSessions.length > 0) {
        const ids = expiredSessions.map(s => s.id);
        
        await supabase
          .from('payment_sessions')
          .update({ status: 'EXPIRED', updated_at: now })
          .in('id', ids);

        applicationLogger.info('Expired sessions marked', { count: expiredSessions.length });
      }

      return expiredSessions?.length || 0;
    } catch (err) {
      errorsLogger.error('Process expired sessions failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = new PaymentWorker();
