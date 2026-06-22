const crypto = require('crypto');
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const paymentMatcher = require('./paymentMatcher');
const {
  paymentsLogger,
  auditLogger,
  errorsLogger,
  macrodroidLogger
} = require('../config/logger');

const PAYMENT_SESSION_TTL_MS = 10 * 60 * 1000;
const UPSELL_TTL_MS = 30 * 60 * 1000;

class PaymentService {
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
      errorsLogger.error('getCheckout failed', { error: err.message, checkoutId });
      return null;
    }
  }

  async getDefaultCheckoutForProduct(productId) {
    try {
      const { data: product } = await supabase
        .from('products')
        .select('default_checkout_id')
        .eq('id', productId)
        .maybeSingle();

      if (product?.default_checkout_id) {
        const checkout = await this.getCheckout(product.default_checkout_id);
        if (checkout?.status === 'active') return checkout;
      }

      const { data: linked } = await supabase
        .from('product_checkouts')
        .select('checkout_id, checkouts:checkout_id(*)')
        .eq('product_id', productId)
        .eq('is_default', true)
        .maybeSingle();

      if (linked?.checkouts?.status === 'active') return linked.checkouts;

      const { data: firstLinked } = await supabase
        .from('product_checkouts')
        .select('checkout_id, checkouts:checkout_id(*)')
        .eq('product_id', productId)
        .limit(1)
        .maybeSingle();

      if (firstLinked?.checkouts?.status === 'active') return firstLinked.checkouts;

      const { data: systemDefault } = await supabase
        .from('checkouts')
        .select('*')
        .eq('status', 'active')
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();

      if (systemDefault) return systemDefault;

      const { data: anyActive } = await supabase
        .from('checkouts')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      return anyActive || null;
    } catch (err) {
      errorsLogger.error('getDefaultCheckoutForProduct failed', { error: err.message, productId });
      return null;
    }
  }

  async assertProductCanUseCheckout(productId, checkoutId) {
    try {
      const checkout = await this.getCheckout(checkoutId);
      if (!checkout) throw new Error('Invalid checkout: checkout not found');
      if (checkout.status !== 'active') throw new Error('Checkout is not active');

      const { data: linked, error } = await supabase
        .from('product_checkouts')
        .select('id')
        .eq('product_id', productId)
        .eq('checkout_id', checkoutId)
        .maybeSingle();

      if (!error && linked) return checkout;

      if (checkout.is_default) return checkout;

      return checkout;
    } catch (err) {
      if (err.message?.includes('relation') || err.message?.includes('schema cache')) {
        const checkout = await this.getCheckout(checkoutId);
        if (!checkout || checkout.status !== 'active') {
          throw new Error('Checkout is not active');
        }
        return checkout;
      }
      throw err;
    }
  }

  normalizeMoney(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('Invalid amount');
    }
    return Number(parsed.toFixed(2));
  }

  async createSession(data) {
    try {
      const checkoutId = data.checkout_id || (await this.getDefaultCheckoutForProduct(data.product_id))?.id;
      if (!checkoutId) throw new Error('No active checkout available for product');

      const checkout = await this.assertProductCanUseCheckout(data.product_id, checkoutId);
      const sessionId = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + PAYMENT_SESSION_TTL_MS).toISOString();
      const expectedAmount = this.normalizeMoney(data.expected_amount);

      const session = {
        id: sessionId,
        product_id: data.product_id,
        checkout_id: checkout.id,
        customer_name: data.customer_name || 'Cliente',
        customer_email: String(data.customer_email || `guest_${uuidv4()}@system.local`).toLowerCase(),
        customer_phone: data.customer_phone || null,
        expected_amount: expectedAmount,
        selected_order_bumps: data.selected_order_bumps || [],
        status: 'WAITING_PAYMENT',
        score: 0,
        processing: false,
        created_at: now,
        updated_at: now,
        expires_at: expiresAt,
        last_activity_at: now,
        copied_entity: checkout.entity,
        copied_reference: checkout.reference,
        copied_value: String(expectedAmount),
        payment_confirmed_at: null,
        delivery_unlocked_at: null,
        upsell_status: 'none',
        upsell_expires_at: null,
        upsell_resolved_at: null,
        utm_data: data.utm_data || {},
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
        checkout_id: checkout.id,
      });

      return result;
    } catch (err) {
      errorsLogger.error('createSession failed', { error: err.message, data });
      throw err;
    }
  }

  async getSession(sessionId) {
    try {
      const { data, error } = await supabase
        .from('payment_sessions')
        .select('*, products:product_id(*), checkouts:checkout_id(*)')
        .eq('id', sessionId)
        .single();

      if (error || !data) return null;

      const { data: delivery } = await supabase
        .from('deliveries')
        .select('delivery_token, status')
        .eq('session_id', sessionId)
        .eq('status', 'unlocked')
        .maybeSingle();

      if (delivery?.delivery_token) {
        data.delivery_token = delivery.delivery_token;
      }

      return data;
    } catch (err) {
      errorsLogger.error('getSession failed', { error: err.message, sessionId });
      return null;
    }
  }

  validTransitions() {
    return {
      CREATED: ['WAITING_PAYMENT', 'EXPIRED', 'CANCELLED'],
      CHECKOUT_OPEN: ['WAITING_PAYMENT', 'EXPIRED', 'CANCELLED'],
      PAYMENT_SESSION_CREATED: ['WAITING_PAYMENT', 'EXPIRED', 'CANCELLED'],
      WAITING_PAYMENT: ['PAYMENT_CONFIRMED', 'EXPIRED', 'FAILED', 'REVIEW_REQUIRED'],
      PAYMENT_CONFIRMED: ['UPSELL_PENDING', 'REVIEW_REQUIRED'],
      UPSELL_PENDING: ['UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'REVIEW_REQUIRED', 'EXPIRED'],
      UPSELL_ACCEPTED: ['DELIVERED', 'REVIEW_REQUIRED'],
      UPSELL_DECLINED: ['DELIVERED', 'REVIEW_REQUIRED'],
      DELIVERED: [],
      EXPIRED: ['REVIEW_REQUIRED'],
      FAILED: ['REVIEW_REQUIRED'],
      CANCELLED: [],
      REVIEW_REQUIRED: ['PAYMENT_CONFIRMED', 'FAILED', 'CANCELLED'],
    };
  }

  async transitionState(sessionId, newStatus, extraUpdates = {}) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const allowed = this.validTransitions()[session.status] || [];
      if (!allowed.includes(newStatus)) {
        throw new Error(`Invalid transition: ${session.status} -> ${newStatus}`);
      }

      const now = new Date().toISOString();
      const updateData = {
        status: newStatus,
        updated_at: now,
        last_activity_at: now,
        ...extraUpdates,
      };

      if (newStatus === 'PAYMENT_CONFIRMED') {
        updateData.payment_confirmed_at = updateData.payment_confirmed_at || now;
      }

      if (newStatus === 'UPSELL_PENDING') {
        updateData.upsell_status = 'pending';
        updateData.upsell_expires_at = updateData.upsell_expires_at || new Date(Date.now() + UPSELL_TTL_MS).toISOString();
      }

      if (newStatus === 'UPSELL_ACCEPTED') {
        updateData.upsell_status = 'accepted';
        updateData.upsell_resolved_at = now;
      }

      if (newStatus === 'UPSELL_DECLINED') {
        updateData.upsell_status = extraUpdates.upsell_status || 'declined';
        updateData.upsell_resolved_at = now;
      }

      if (newStatus === 'DELIVERED') {
        updateData.delivery_unlocked_at = updateData.delivery_unlocked_at || now;
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
      errorsLogger.error('transitionState failed', { error: err.message, sessionId, newStatus });
      throw err;
    }
  }

  async openCheckout(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'CREATED') return this.transitionState(sessionId, 'WAITING_PAYMENT');
    return this.updateActivity(sessionId);
  }

  async startPayment(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'CREATED') return this.transitionState(sessionId, 'WAITING_PAYMENT');
    return this.updateActivity(sessionId);
  }

  async waitPayment(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (['CREATED', 'CHECKOUT_OPEN', 'PAYMENT_SESSION_CREATED'].includes(session.status)) {
      return this.transitionState(sessionId, 'WAITING_PAYMENT');
    }
    return this.updateActivity(sessionId);
  }

  async updateActivity(sessionId) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('payment_sessions')
      .update({ last_activity_at: now, updated_at: now })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async copyEntity(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const value = session.checkouts?.entity || session.copied_entity;
    return this.updateSessionCopy(sessionId, { copied_entity: value });
  }

  async copyReference(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const value = session.checkouts?.reference || session.copied_reference;
    return this.updateSessionCopy(sessionId, { copied_reference: value });
  }

  async copyValue(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    return this.updateSessionCopy(sessionId, { copied_value: String(session.expected_amount) });
  }

  async updateSessionCopy(sessionId, fields) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('payment_sessions')
      .update({ ...fields, last_activity_at: now, updated_at: now })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async forceExpire(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'WAITING_PAYMENT') return this.transitionState(sessionId, 'EXPIRED');
    if (['CREATED', 'CHECKOUT_OPEN', 'PAYMENT_SESSION_CREATED'].includes(session.status)) {
      return this.transitionState(sessionId, 'EXPIRED');
    }
    return session;
  }

  async beginUpsell(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'UPSELL_PENDING') return session;
    if (session.status !== 'PAYMENT_CONFIRMED') {
      throw new Error(`Cannot begin upsell from ${session.status}`);
    }
    return this.transitionState(sessionId, 'UPSELL_PENDING');
  }

  async confirmPaymentAndBeginUpsell(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.status === 'UPSELL_PENDING') return session;
    if (['UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'DELIVERED'].includes(session.status)) return session;

    const confirmed = session.status === 'PAYMENT_CONFIRMED'
      ? session
      : await this.transitionState(sessionId, 'PAYMENT_CONFIRMED');

    return this.beginUpsell(confirmed.id);
  }

  async lockSession(sessionId) {
    try {
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({ processing: true })
        .eq('id', sessionId)
        .eq('processing', false)
        .select()
        .single();

      if (error || !data) return null;
      return data;
    } catch (err) {
      errorsLogger.error('lockSession failed', { error: err.message, sessionId });
      return null;
    }
  }

  async unlockSession(sessionId) {
    await supabase
      .from('payment_sessions')
      .update({ processing: false })
      .eq('id', sessionId);
  }

  generateFingerprint(payload) {
    const amount = this.normalizeMoney(payload.amount).toFixed(2);
    const raw = [
      amount,
      payload.entity || '',
      payload.reference || '',
      payload.received_at || '',
      payload.sender || '',
      payload.raw_message || ''
    ].join('|').toLowerCase().trim();

    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async checkAndLockPaymentEvent(fingerprint, payload) {
    const event = {
      id: uuidv4(),
      fingerprint,
      amount: this.normalizeMoney(payload.amount),
      entity: payload.entity || null,
      reference: payload.reference || null,
      received_at: payload.received_at || new Date().toISOString(),
      raw_message: payload.raw_message || null,
      sender: payload.sender || null,
      payload,
      status: 'received',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('payment_events')
      .insert(event)
      .select()
      .single();

    if (error) {
      if (error.code === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
        return { ignored: true, reason: 'duplicate' };
      }
      throw error;
    }

    return { ignored: false, event: data };
  }

  async markPaymentEvent(fingerprint, updates) {
    try {
      await supabase
        .from('payment_events')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('fingerprint', fingerprint);
    } catch (err) {
      errorsLogger.error('markPaymentEvent failed', { error: err.message, fingerprint });
    }
  }

  async getCandidateSessions(amount, includeExpired = false) {
    let query = supabase
      .from('payment_sessions')
      .select('*')
      .eq('expected_amount', this.normalizeMoney(amount));

    query = includeExpired
      ? query.in('status', ['WAITING_PAYMENT', 'EXPIRED'])
      : query.eq('status', 'WAITING_PAYMENT');

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async markSessionsForReview(sessions, reason, payload = {}) {
    const ids = sessions.map(s => s.id).filter(Boolean);
    if (ids.length === 0) return;

    await supabase
      .from('payment_sessions')
      .update({
        status: 'REVIEW_REQUIRED',
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .in('id', ids)
      .in('status', ['WAITING_PAYMENT', 'EXPIRED', 'FAILED']);

    auditLogger.warn('Sessions marked for review', {
      reason,
      sessions: ids,
      payload,
    });
  }

  async processPaymentWebhook(data) {
    const fingerprint = data.fingerprint || this.generateFingerprint(data);

    try {
      const amount = this.normalizeMoney(data.amount);
      const candidates = await this.getCandidateSessions(amount, true);
      const waitingCandidates = candidates.filter(s => s.status === 'WAITING_PAYMENT');
      const expiredCandidates = candidates.filter(s => s.status === 'EXPIRED');

      if (waitingCandidates.length === 0) {
        if (expiredCandidates.length > 0) {
          await this.markSessionsForReview(expiredCandidates, 'payment_after_expiration', data);
          const result = {
            status: 'review_required',
            reason: 'payment_after_expiration',
            session_ids: expiredCandidates.map(s => s.id),
          };
          await this.markPaymentEvent(fingerprint, { status: 'review_required', result });
          return result;
        }

        const result = { status: 'no_match' };
        await this.markPaymentEvent(fingerprint, { status: 'failed', result });
        return result;
      }

      const scored = paymentMatcher.scoreCandidates(waitingCandidates, amount);
      const picked = paymentMatcher.pickBest(scored);

      if (!picked.matched) {
        const tiedSessions = picked.tied?.map(t => t.session) || waitingCandidates;
        await this.markSessionsForReview(tiedSessions, picked.reason || 'ambiguous_payment', data);

        const result = {
          status: 'review_required',
          reason: picked.reason || 'AMBIGUITY',
          session_ids: tiedSessions.map(s => s.id),
        };
        await this.markPaymentEvent(fingerprint, { status: 'review_required', result });
        return result;
      }

      const best = picked.best.session;
      if (new Date(best.expires_at).getTime() < Date.now()) {
        await this.markSessionsForReview([best], 'payment_after_expiration', data);
        const result = {
          status: 'review_required',
          reason: 'payment_after_expiration',
          session_id: best.id,
        };
        await this.markPaymentEvent(fingerprint, { status: 'review_required', result });
        return result;
      }

      await this.confirmPaymentAndBeginUpsell(best.id);

      const result = {
        status: waitingCandidates.length === 1 ? 'matched_single' : 'matched',
        session_id: best.id,
        next_status: 'UPSELL_PENDING',
      };

      paymentsLogger.info('Payment matched and upsell opened', {
        session_id: best.id,
        amount,
        fingerprint,
      });

      await this.markPaymentEvent(fingerprint, {
        status: 'processed',
        processed_session_id: best.id,
        result,
      });

      return result;
    } catch (err) {
      errorsLogger.error('processPaymentWebhook failed', { error: err.message, data });
      await this.markPaymentEvent(fingerprint, { status: 'failed', error_message: err.message });
      throw err;
    }
  }

  async getReviewRequiredSessions() {
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*, products:product_id(name, price), checkouts:checkout_id(name, entity, reference)')
      .eq('status', 'REVIEW_REQUIRED')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async resolveReview(sessionId, action, justification) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'REVIEW_REQUIRED') {
      throw new Error(`Session is not in review: ${session.status}`);
    }

    auditLogger.warn('Review resolved', {
      session_id: sessionId,
      action,
      justification,
    });

    if (action === 'confirm') {
      const confirmed = await this.transitionState(sessionId, 'PAYMENT_CONFIRMED');
      return this.beginUpsell(confirmed.id);
    }

    return this.transitionState(sessionId, 'FAILED');
  }

  async listSessions(filters = {}) {
    let query = supabase
      .from('payment_sessions')
      .select('*, products:product_id(name, price), checkouts:checkout_id(name, entity, reference)', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.email) query = query.ilike('customer_email', `%${filters.email}%`);
    if (filters.product_id) query = query.eq('product_id', filters.product_id);

    const limit = Math.min(filters.limit || 20, 100);
    const offset = filters.offset || 0;

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      data: data || [],
      total: count || 0,
      limit,
      offset,
    };
  }
}

module.exports = new PaymentService();
