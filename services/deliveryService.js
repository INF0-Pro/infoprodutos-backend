const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { deliveriesLogger, auditLogger, errorsLogger } = require('../config/logger');

class DeliveryService {
  /**
   * Generate a secure delivery token
   */
  generateDeliveryToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Unlock delivery for a session
   */
  async unlockDelivery(sessionId) {
    try {
      const { data: session, error } = await supabase
        .from('payment_sessions')
        .select('*, products:product_id(*)')
        .eq('id', sessionId)
        .single();

      if (error || !session) {
        throw new Error('Session not found');
      }

      // Only deliver if PAYMENT_CONFIRMED, UPSELL_ACCEPTED, or UPSELL_DECLINED
      const allowedStatuses = ['PAYMENT_CONFIRMED', 'UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'DELIVERED'];
      if (!allowedStatuses.includes(session.status)) {
        throw new Error(`Cannot deliver: session status is ${session.status}`);
      }

      const deliveryToken = this.generateDeliveryToken();
      const now = new Date().toISOString();

      // Create delivery record
      const { data: delivery, error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          id: uuidv4(),
          session_id: sessionId,
          product_id: session.product_id,
          customer_email: session.customer_email,
          delivery_token: deliveryToken,
          content_type: session.products?.content_type || 'link',
          content_url: session.products?.content_url || null,
          status: 'unlocked',
          created_at: now,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        })
        .select()
        .single();

      if (deliveryError) throw deliveryError;

      // Update session to DELIVERED if not already
      if (session.status !== 'DELIVERED') {
        await supabase
          .from('payment_sessions')
          .update({
            status: 'DELIVERED',
            delivery_unlocked_at: now,
            updated_at: now,
          })
          .eq('id', sessionId);
      }

      deliveriesLogger.info('Delivery unlocked', { sessionId, deliveryId: delivery.id });
      auditLogger.info('Delivery unlocked', { session_id: sessionId, delivery_id: delivery.id });

      return delivery;
    } catch (err) {
      errorsLogger.error('Failed to unlock delivery', { error: err.message, sessionId });
      throw err;
    }
  }

  /**
   * Get delivery by token
   */
  async getDeliveryByToken(token) {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, products:product_id(name, description, content_type, content_url)')
      .eq('delivery_token', token)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Get delivery by session ID
   */
  async getDeliveryBySession(sessionId) {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Record download event
   */
  async recordDownload(deliveryId, ipAddress) {
    try {
      const { data, error } = await supabase
        .from('deliveries')
        .update({
          downloaded_at: new Date().toISOString(),
          download_ip: ipAddress,
          download_count: supabase.rpc('increment', { x: 1 }),
        })
        .eq('id', deliveryId)
        .select()
        .single();

      if (error) {
        // Fallback: increment manually
        const { data: current } = await supabase
          .from('deliveries')
          .select('download_count')
          .eq('id', deliveryId)
          .single();

        const newCount = (current?.download_count || 0) + 1;
        await supabase
          .from('deliveries')
          .update({
            downloaded_at: new Date().toISOString(),
            download_ip: ipAddress,
            download_count: newCount,
          })
          .eq('id', deliveryId);
      }

      deliveriesLogger.info('Product downloaded', { deliveryId, ipAddress });
    } catch (err) {
      errorsLogger.error('Failed to record download', { error: err.message, deliveryId });
    }
  }
}

module.exports = new DeliveryService();
