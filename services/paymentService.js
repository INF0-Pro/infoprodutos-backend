const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { paymentsLogger, auditLogger, errorsLogger, macrodroidLogger } = require('../config/logger');

class PaymentService {
  /**
   * Create a new payment session
   */
  async createSession(data) {
    try {
      // Validate checkout exists
      const { data: checkout, error: checkoutError } = await supabase
        .from('checkouts')
        .select('*')
        .eq('id', data.checkout_id)
        .single();

      if (checkoutError || !checkout) {
        throw new Error('Invalid checkout: checkout not found');
      }

      if (checkout.status !== 'active') {
        throw new Error('Checkout is not active');
      }

      const sessionId = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

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

      // Audit log
      auditLogger.info('Payment session created', {
        session_id: sessionId,
        product_id: data.product_id,
        checkout_id: data.checkout_id,
        customer_email: data.customer_email,
        expected_amount: data.expected_amount,
        status: 'CREATED',
      });

      paymentsLogger.info('Payment session created', { sessionId, customerEmail: data.customer_email });

      return result;
    } catch (err) {
      errorsLogger.error('Failed to create payment session', { error: err.message, data });
      throw err;
    }
  }

  /**
   * Transition session to WAITING_PAYMENT
   */
  async openCheckout(sessionId) {
    return this.transitionState(sessionId, 'CHECKOUT_OPEN');
  }

  async startPayment(sessionId) {
    return this.transitionState(sessionId, 'PAYMENT_SESSION_CREATED');
  }

  async waitPayment(sessionId) {
    return this.transitionState(sessionId, 'WAITING_PAYMENT');
  }

  /**
   * Transition session state with FSM validation
   */
  async transitionState(sessionId, newStatus) {
    const validTransitions = {
      'CREATED': ['CHECKOUT_OPEN'],
      'CHECKOUT_OPEN': ['PAYMENT_SESSION_CREATED', 'EXPIRED', 'CANCELLED'],
      'PAYMENT_SESSION_CREATED': ['WAITING_PAYMENT', 'EXPIRED', 'CANCELLED'],
      'WAITING_PAYMENT': ['PAYMENT_CONFIRMED', 'EXPIRED', 'FAILED', 'REVIEW_REQUIRED'],
      'PAYMENT_CONFIRMED': ['UPSELL_PENDING', 'DELIVERED', 'REVIEW_REQUIRED'],
      'UPSELL_PENDING': ['UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'EXPIRED'],
      'UPSELL_ACCEPTED': ['DELIVERED', 'REVIEW_REQUIRED'],
      'UPSELL_DECLINED': ['DELIVERED'],
      'DELIVERED': ['REVIEW_REQUIRED'],
      'EXPIRED': [],
      'FAILED': ['REVIEW_REQUIRED'],
      'CANCELLED': [],
      'REVIEW_REQUIRED': ['PAYMENT_CONFIRMED', 'FAILED', 'CANCELLED', 'DELIVERED'],
    };

    try {
      const { data: session, error: fetchError } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (fetchError || !session) {
        throw new Error('Session not found');
      }

      const allowed = validTransitions[session.status] || [];
      if (!allowed.includes(newStatus)) {
        throw new Error(
          `Invalid state transition: ${session.status} -> ${newStatus}. Allowed: ${allowed.join(', ')}`
        );
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

      const { data: result, error: updateError } = await supabase
        .from('payment_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Audit
      auditLogger.info('State transition', {
        session_id: sessionId,
        from: session.status,
        to: newStatus,
        timestamp: now,
      });

      paymentsLogger.info('Session state changed', {
        sessionId,
        from: session.status,
        to: newStatus,
      });

      return result;
    } catch (err) {
      errorsLogger.error('State transition failed', { error: err.message, sessionId, newStatus });
      throw err;
    }
  }

  /**
   * Process MacroDroid webhook payment validation
   */
  async processPaymentWebhook(payload) {
    const { amount, entity, reference, received_at, raw_message, sender } = payload;

    macrodroidLogger.info('Payment webhook received', { amount, entity, reference, sender });

    try {
      // Find matching sessions: WAITING_PAYMENT, not expired
      const now = new Date().toISOString();
      const { data: candidates, error } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('status', 'WAITING_PAYMENT')
        .gte('expires_at', now)
        .eq('copied_entity', entity)
        .eq('copied_reference', reference);

      if (error) throw error;

      if (!candidates || candidates.length === 0) {
        macrodroidLogger.warn('No matching sessions found', { entity, reference, amount });
        return { matched: false, reason: 'No matching sessions' };
      }

      // Decision engine: score each candidate
      const scored = candidates.map(session => {
        let score = 0;

        // Session is open (WAITING_PAYMENT)
        score += 50;

        // Reference was copied
        if (session.copied_reference === reference) score += 30;

        // Activity recency
        const lastActivity = new Date(session.last_activity_at).getTime();
        const nowMs = Date.now();
        const diffMinutes = (nowMs - lastActivity) / 60000;

        if (diffMinutes < 2) score += 20;
        else if (diffMinutes < 5) score += 10;
        else if (diffMinutes < 10) score += 5;

        // Recent session
        const createdAt = new Date(session.created_at).getTime();
        const ageMinutes = (nowMs - createdAt) / 60000;
        if (ageMinutes < 5) score += 15;

        // Old session penalty
        if (ageMinutes > 10) score -= 30;

        // Exact amount match bonus
        if (Math.abs(session.expected_amount - amount) < 0.01) score += 25;

        return { session, score };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Check for ambiguity
      if (scored.length > 1 && scored[0].score === scored[1].score) {
        // Ambiguity: tie between sessions
        auditLogger.warn('Payment ambiguity detected - tie', {
          amount,
          entity,
          reference,
          candidates: scored.map(s => ({ id: s.session.id, score: s.score })),
        });

        // Mark all tied sessions as REVIEW_REQUIRED
        for (const { session } of scored) {
          await this.transitionState(session.id, 'REVIEW_REQUIRED');
        }

        macrodroidLogger.warn('Payment ambiguity - tie, marked REVIEW_REQUIRED', {
          amount,
          entity,
          reference,
          tiedSessions: scored.filter(s => s.score === scored[0].score).map(s => s.session.id),
        });

        return {
          matched: false,
          reason: 'Ambiguity: multiple sessions with same score',
          status: 'REVIEW_REQUIRED',
        };
      }

      const bestMatch = scored[0];

      // Check if amount matches (zero tolerance)
      if (Math.abs(bestMatch.session.expected_amount - amount) > 0.01) {
        auditLogger.warn('Amount mismatch', {
          session_id: bestMatch.session.id,
          expected: bestMatch.session.expected_amount,
          received: amount,
        });
        return { matched: false, reason: 'Amount mismatch' };
      }

      // Confirm payment
      const updatedSession = await this.transitionState(bestMatch.session.id, 'PAYMENT_CONFIRMED');

      // Update copied_value
      await supabase
        .from('payment_sessions')
        .update({ copied_value: amount.toString() })
        .eq('id', bestMatch.session.id);

      // Log rejected sessions
      const rejectedSessions = scored.slice(1).map(s => ({
        id: s.session.id,
        score: s.score,
        reason: 'Lower score',
      }));

      auditLogger.info('Payment confirmed', {
        session_id: bestMatch.session.id,
        chosen_score: bestMatch.score,
        rejected_sessions: rejectedSessions,
        amount,
        entity,
        reference,
        raw_payload: { amount, entity, reference, received_at, sender },
      });

      macrodroidLogger.info('Payment confirmed', {
        sessionId: bestMatch.session.id,
        score: bestMatch.score,
        amount,
      });

      return {
        matched: true,
        session_id: bestMatch.session.id,
        score: bestMatch.score,
        status: 'PAYMENT_CONFIRMED',
      };
    } catch (err) {
      errorsLogger.error('Payment webhook processing failed', { error: err.message, payload });
      throw err;
    }
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(sessionId) {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({ last_activity_at: now, updated_at: now })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;
      
      paymentsLogger.debug('Session activity updated', { sessionId });
      return data;
    } catch (err) {
      errorsLogger.error('Failed to update activity', { error: err.message, sessionId });
      throw err;
    }
  }

  /**
   * Register entity copy
   */
  async copyEntity(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({
          copied_entity: session.checkouts?.entity || session.copied_entity,
          last_activity_at: now,
          updated_at: now,
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;

      auditLogger.info('Entity copied', { session_id: sessionId });
      paymentsLogger.info('Entity copied', { sessionId });

      return data;
    } catch (err) {
      errorsLogger.error('Failed to register entity copy', { error: err.message, sessionId });
      throw err;
    }
  }

  /**
   * Register reference copy
   */
  async copyReference(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({
          copied_reference: session.checkouts?.reference || session.copied_reference,
          last_activity_at: now,
          updated_at: now,
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;

      auditLogger.info('Reference copied', { session_id: sessionId });
      paymentsLogger.info('Reference copied', { sessionId });

      return data;
    } catch (err) {
      errorsLogger.error('Failed to register reference copy', { error: err.message, sessionId });
      throw err;
    }
  }

  /**
   * Register value copy
   */
  async copyValue(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found');

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('payment_sessions')
        .update({
          copied_value: session.expected_amount.toString(),
          last_activity_at: now,
          updated_at: now,
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;

      auditLogger.info('Value copied', { session_id: sessionId, value: session.expected_amount });
      paymentsLogger.info('Value copied', { sessionId, value: session.expected_amount });

      return data;
    } catch (err) {
      errorsLogger.error('Failed to register value copy', { error: err.message, sessionId });
      throw err;
    }
  }

  /**
   * Force expire a session
   */
  async forceExpire(sessionId) {
    return this.transitionState(sessionId, 'EXPIRED');
  }

  /**
   * Resolve a REVIEW_REQUIRED session
   */
  async resolveReview(sessionId, action, justification) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found');
      if (session.status !== 'REVIEW_REQUIRED') {
        throw new Error(`Session is ${session.status}, not REVIEW_REQUIRED`);
      }

      if (action === 'confirm') {
        const result = await this.transitionState(sessionId, 'PAYMENT_CONFIRMED');
        auditLogger.info('Review resolved: payment confirmed', {
          session_id: sessionId,
          justification,
          resolved_by: 'admin',
        });
        return result;
      } else if (action === 'cancel') {
        const result = await this.transitionState(sessionId, 'CANCELLED');
        auditLogger.info('Review resolved: payment cancelled', {
          session_id: sessionId,
          justification,
          resolved_by: 'admin',
        });
        return result;
      } else if (action === 'fail') {
        const result = await this.transitionState(sessionId, 'FAILED');
        auditLogger.info('Review resolved: payment failed', {
          session_id: sessionId,
          justification,
          resolved_by: 'admin',
        });
        return result;
      } else {
        throw new Error('Invalid action. Use: confirm, cancel, or fail');
      }
    } catch (err) {
      errorsLogger.error('Failed to resolve review', { error: err.message, sessionId, action });
      throw err;
    }
  }

  /**
   * Debug payment processing (dry run - no state changes)
   */
  async debugProcessPayment(payload) {
    const { amount, entity, reference } = payload;

    const result = {
      dry_run: true,
      input: { amount, entity, reference },
      candidates: [],
      decision: null,
      timestamp: new Date().toISOString(),
    };

    try {
      const now = new Date().toISOString();
      const { data: candidates, error } = await supabase
        .from('payment_sessions')
        .select('*')
        .eq('status', 'WAITING_PAYMENT')
        .gte('expires_at', now)
        .eq('copied_entity', entity)
        .eq('copied_reference', reference);

      if (error) throw error;

      if (!candidates || candidates.length === 0) {
        result.decision = { matched: false, reason: 'No matching sessions' };
        return result;
      }

      // Score each candidate (same logic as processPaymentWebhook)
      const scored = candidates.map(session => {
        let score = 0;
        score += 50; // Session is open
        if (session.copied_reference === reference) score += 30;

        const lastActivity = new Date(session.last_activity_at).getTime();
        const nowMs = Date.now();
        const diffMinutes = (nowMs - lastActivity) / 60000;
        if (diffMinutes < 2) score += 20;
        else if (diffMinutes < 5) score += 10;
        else if (diffMinutes < 10) score += 5;

        const createdAt = new Date(session.created_at).getTime();
        const ageMinutes = (nowMs - createdAt) / 60000;
        if (ageMinutes < 5) score += 15;
        if (ageMinutes > 10) score -= 30;
        if (Math.abs(session.expected_amount - amount) < 0.01) score += 25;

        return {
          session_id: session.id,
          customer_email: session.customer_email,
          customer_name: session.customer_name,
          expected_amount: session.expected_amount,
          status: session.status,
          score,
          last_activity_at: session.last_activity_at,
          created_at: session.created_at,
          expires_at: session.expires_at,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      result.candidates = scored;

      // Check ambiguity
      if (scored.length > 1 && scored[0].score === scored[1].score) {
        result.decision = {
          matched: false,
          reason: 'Ambiguity: multiple sessions with same score',
          would_set_status: 'REVIEW_REQUIRED',
          tied_sessions: scored.filter(s => s.score === scored[0].score).map(s => s.session_id),
        };
        return result;
      }

      const bestMatch = scored[0];

      // Amount mismatch
      if (Math.abs(bestMatch.expected_amount - amount) > 0.01) {
        result.decision = {
          matched: false,
          reason: 'Amount mismatch',
          expected: bestMatch.expected_amount,
          received: amount,
        };
        return result;
      }

      result.decision = {
        matched: true,
        session_id: bestMatch.session_id,
        score: bestMatch.score,
        would_set_status: 'PAYMENT_CONFIRMED',
      };

      return result;
    } catch (err) {
      result.decision = { matched: false, reason: `Error: ${err.message}` };
      return result;
    }
  }

  /**
   * Get sessions in REVIEW_REQUIRED status
   */
  async getReviewRequiredSessions() {
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*, products:product_id(name, price), checkouts:checkout_id(name, entity, reference)')
      .eq('status', 'REVIEW_REQUIRED')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId) {
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*, products:product_id(name, price, content_type), checkouts:checkout_id(name, entity, reference)')
      .eq('id', sessionId)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * List sessions with filters
   */
  async listSessions(filters = {}) {
    let query = supabase
      .from('payment_sessions')
      .select('*, products:product_id(name), checkouts:checkout_id(name)', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.email) query = query.eq('customer_email', filters.email.toLowerCase());
    if (filters.product_id) query = query.eq('product_id', filters.product_id);
    if (filters.start_date) query = query.gte('created_at', filters.start_date);
    if (filters.end_date) query = query.lte('created_at', filters.end_date);

    query = query.order('created_at', { ascending: false });

    if (filters.limit) query = query.limit(filters.limit);
    if (filters.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data, count };
  }
}

module.exports = new PaymentService();
