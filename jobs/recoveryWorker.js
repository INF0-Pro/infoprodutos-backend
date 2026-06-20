const { supabase } = require('../config/database');
const paymentWorker = require('./paymentWorker');
const upsellWorker = require('./upsellWorker');
const { applicationLogger, errorsLogger } = require('../config/logger');

class RecoveryWorker {
  constructor() {
    this.interval = null;
    this.running = false;
  }

  start(intervalMs = 300000) {
    if (this.running) return;
    this.running = true;

    applicationLogger.info('Recovery worker started', { interval: intervalMs });

    this.interval = setInterval(async () => {
      try {
        await this.validateGlobalConsistency();
      } catch (err) {
        errorsLogger.error('Recovery worker error', { error: err.message });
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    applicationLogger.info('Recovery worker stopped');
  }

  async recoverSystem() {
    applicationLogger.info('System recovery started');

    try {
      // 1. Restore WAITING_PAYMENT sessions
      const recovered = await paymentWorker.recoverSessions();
      applicationLogger.info('Recovery: restored WAITING_PAYMENT sessions', { count: recovered.length });

      // 2. Expire old sessions
      await paymentWorker.processExpiredSessions();

      // 3. Process timed out upsells
      await upsellWorker.processTimedOutUpsells();

      // 4. Validate consistency
      await this.validateGlobalConsistency();

      applicationLogger.info('System recovery completed');
      return { recovered: recovered.length, status: 'ok' };
    } catch (err) {
      errorsLogger.error('System recovery failed', { error: err.message });
      throw err;
    }
  }

  async validateGlobalConsistency() {
    const inconsistencies = [];

    try {
      // Check: sessions with PAYMENT_CONFIRMED but no delivery
      const { data: confirmedNoDelivery, error: err1 } = await supabase
        .from('payment_sessions')
        .select('id, customer_email, status')
        .eq('status', 'PAYMENT_CONFIRMED');

      if (err1) throw err1;

      for (const session of confirmedNoDelivery || []) {
        const { data: delivery } = await supabase
          .from('deliveries')
          .select('id')
          .eq('session_id', session.id)
          .single();

        if (!delivery) {
          inconsistencies.push({
            type: 'MISSING_DELIVERY',
            session_id: session.id,
            detail: 'PAYMENT_CONFIRMED but no delivery record',
          });
        }
      }

      // Check: sessions with DELIVERED but no payment confirmation
      const { data: deliveredNoPayment, error: err2 } = await supabase
        .from('payment_sessions')
        .select('id, customer_email, status')
        .eq('status', 'DELIVERED')
        .is('payment_confirmed_at', null);

      if (err2) throw err2;

      for (const session of deliveredNoPayment || []) {
        inconsistencies.push({
          type: 'DELIVERY_WITHOUT_PAYMENT',
          session_id: session.id,
          detail: 'DELIVERED but no payment_confirmed_at',
        });
      }

      // Check: expired sessions that are still in active states
      const now = new Date().toISOString();
      const { data: staleSessions, error: err3 } = await supabase
        .from('payment_sessions')
        .select('id, status, expires_at')
        .in('status', ['WAITING_PAYMENT', 'PAYMENT_SESSION_CREATED', 'CHECKOUT_OPEN', 'CREATED'])
        .lt('expires_at', now);

      if (err3) throw err3;

      for (const session of staleSessions || []) {
        inconsistencies.push({
          type: 'STALE_SESSION',
          session_id: session.id,
          detail: `Session ${session.status} but expired at ${session.expires_at}`,
        });
      }

      if (inconsistencies.length > 0) {
        applicationLogger.warn('Consistency validation found issues', {
          count: inconsistencies.length,
          issues: inconsistencies,
        });

        // Auto-fix stale sessions
        if (staleSessions && staleSessions.length > 0) {
          await supabase
            .from('payment_sessions')
            .update({ status: 'EXPIRED', updated_at: now })
            .in('id', staleSessions.map(s => s.id));
        }
      } else {
        applicationLogger.info('Consistency validation passed - no issues found');
      }
    } catch (err) {
      errorsLogger.error('Consistency validation failed', { error: err.message });
    }

    return inconsistencies;
  }
}

module.exports = new RecoveryWorker();
