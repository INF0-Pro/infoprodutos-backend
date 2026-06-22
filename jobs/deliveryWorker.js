const { supabase } = require('../config/database');
const deliveryService = require('../services/deliveryService');
const { applicationLogger, errorsLogger } = require('../config/logger');

class DeliveryWorker {
  constructor() {
    this.interval = null;
    this.running = false;
    this.processing = false; // 🔥 evita execução paralela
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
    if (this.processing) return; // 🔥 proteção contra overlap
    this.processing = true;

    try {
      const { data: sessions, error } = await supabase
        .from('payment_sessions')
        .select('id, status, delivery_unlocked_at, product_id, customer_email')
        .in('status', ['UPSELL_ACCEPTED', 'UPSELL_DECLINED'])
        .is('delivery_unlocked_at', null)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) throw error;

      if (!sessions || sessions.length === 0) return;

      applicationLogger.info('Processing pending deliveries', {
        count: sessions.length
      });

      for (const session of sessions) {
        try {
          // 🔥 IDEMPOTÊNCIA: evita duplicação
          const { data: existing } = await supabase
            .from('deliveries')
            .select('id')
            .eq('session_id', session.id)
            .maybeSingle();

          if (existing) {
            // já foi entregue → sincroniza sessão
            await supabase
              .from('payment_sessions')
              .update({
                delivery_unlocked_at: new Date().toISOString(),
                status: 'DELIVERED'
              })
              .eq('id', session.id);

            continue;
          }

          // 🔥 entrega real
          await deliveryService.unlockDelivery(session.id);

        } catch (err) {
          errorsLogger.error('Delivery failed for session', {
            sessionId: session.id,
            error: err.message
          });
        }
      }

    } catch (err) {
      errorsLogger.error('Process pending deliveries failed', {
        error: err.message
      });
      throw err;

    } finally {
      this.processing = false;
    }
  }
}

module.exports = new DeliveryWorker();
