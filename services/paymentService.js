const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const {
  paymentsLogger,
  auditLogger,
  errorsLogger,
  macrodroidLogger
} = require('../config/logger');

class PaymentService {

  /**
   * 🔹 HELPER: Get checkout
   */
  async getCheckout(checkoutId) {
    try {
      const { data, error } = await supabase
        .from('checkouts')
        .select('*')
        .eq('id', checkoutId)
        .single();

      if (error || !data) return null;
      return data;

    } catch (err) {
      errorsLogger.error('getCheckout failed', {
        error: err.message,
        checkoutId
      });
      return null;
    }
  }

  /**
   * Create session
   */
  async createSession(data) {
    try {
      const checkout = await this.getCheckout(data.checkout_id);

      if (!checkout) {
        throw new Error('Invalid checkout: checkout not found');
      }

      if (checkout.status !== 'active') {
        throw new Error('Checkout is not active');
      }

      const sessionId = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const session = {
        id: sessionId,
        product_id: data.product_id,
        checkout_id: data.checkout_id,
        customer_name: data.customer_name,
        customer_email: data.customer_email.toLowerCase(),
        customer_phone: data.customer_phone || null,
        expected_amount: data.expected_amount,
        selected_order_bumps: data.selected_order_bumps || [],
        status: 'CREATED',
        score: 0,
        created_at: now,
        updated_at: now,
        expires_at: expiresAt,
        last_activity_at: now,

        copied_entity: checkout.entity,
        copied_reference: checkout.reference,

        copied_value: null,
        payment_confirmed_at: null,
        delivery_unlocked_at: null,
        upsell_status: 'none',
        utm_data: data.utm_data || null,
      };

      const { data: result, error } = await supabase
        .from('payment_sessions')
        .insert(session)
        .select()
        .single();

      if (error) throw error;

      auditLogger.info('Payment session created', {
        session_id: sessionId,
        product_id: data.product_id,
        checkout_id: data.checkout_id,
      });

      return result;

    } catch (err) {
      errorsLogger.error('createSession failed', {
        error: err.message,
        data
      });
      throw err;
    }
  }

  /**
   * 🔹 HELPER: Get session
   */
  async getSession(sessionId) {
    try {
      const { data, error } = await supabase
        .from('payment_sessions')
        .select('*, products:product_id(name, price), checkouts:checkout_id(name, entity, reference)')
        .eq('id', sessionId)
        .single();

      if (error || !data) return null;
      return data;

    } catch (err) {
      errorsLogger.error('getSession failed', {
        error: err.message,
        sessionId
      });
      return null;
    }
  }

  /**
   * 🔥 PASSO 6.1 — LOCK ANTI-DUPLICAÇÃO
   */
  async lockSession(sessionId) {
    try {
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({
          processing: true
        })
        .eq('id', sessionId)
        .eq('processing', false)
        .select()
        .single();

      if (error || !data) {
        return null; // já está a ser processado
      }

      return data;

    } catch (err) {
      errorsLogger.error('lockSession failed', {
        error: err.message,
        sessionId
      });
      return null;
    }
  }

  /**
   * FSM transitions
   */
  async transitionState(sessionId, newStatus) {
    const validTransitions = {
      CREATED: ['CHECKOUT_OPEN'],
      CHECKOUT_OPEN: ['PAYMENT_SESSION_CREATED', 'EXPIRED', 'CANCELLED'],
      PAYMENT_SESSION_CREATED: ['WAITING_PAYMENT', 'EXPIRED', 'CANCELLED'],
      WAITING_PAYMENT: ['PAYMENT_CONFIRMED', 'EXPIRED', 'FAILED', 'REVIEW_REQUIRED'],
      PAYMENT_CONFIRMED: ['UPSELL_PENDING', 'DELIVERED', 'REVIEW_REQUIRED'],
      UPSELL_PENDING: ['UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'EXPIRED'],
      UPSELL_ACCEPTED: ['DELIVERED', 'REVIEW_REQUIRED'],
      UPSELL_DECLINED: ['DELIVERED'],
      DELIVERED: ['REVIEW_REQUIRED'],
      EXPIRED: [],
      FAILED: ['REVIEW_REQUIRED'],
      CANCELLED: [],
      REVIEW_REQUIRED: ['PAYMENT_CONFIRMED', 'FAILED', 'CANCELLED', 'DELIVERED'],
    };

    try {
      const session = await this.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      const allowed = validTransitions[session.status] || [];

      if (!allowed.includes(newStatus)) {
        throw new Error(`Invalid transition: ${session.status} -> ${newStatus}`);
      }

      const now = new Date().toISOString();

      const updateData = {
        status: newStatus,
        updated_at: now,
        last_activity_at: now,
      };

      if (newStatus === 'PAYMENT_CONFIRMED') {
        updateData.payment_confirmed_at = now;
      }

      if (newStatus === 'DELIVERED') {
        updateData.delivery_unlocked_at = now;
      }

      const { data: result, error } = await supabase
        .from('payment_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;

      auditLogger.info('State transition', {
        session_id: sessionId,
        from: session.status,
        to: newStatus,
      });

      return result;

    } catch (err) {
      errorsLogger.error('transitionState failed', {
        error: err.message,
        sessionId,
        newStatus
      });
      throw err;
    }
  }
}

module.exports = new PaymentService();