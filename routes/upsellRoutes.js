const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const paymentService = require('../services/paymentService');
const deliveryService = require('../services/deliveryService');
const trackingService = require('../services/trackingService');
const { validateUpsell } = require('../middleware/validation');
const { errorsLogger } = require('../config/logger');

async function loadUpsellRules(productId) {
  const { data: productUpsells, error: rulesError } = await supabase
    .from('product_upsells')
    .select('*, products:upsell_product_id(name, price, description, content_type, cover_url)')
    .eq('main_product_id', productId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });

  if (!rulesError && productUpsells?.length) {
    return productUpsells;
  }

  const { data: legacyUpsells, error: legacyError } = await supabase
    .from('upsells')
    .select('*, products:product_id(name, price, description, content_type, cover_url)')
    .eq('main_product_id', productId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });

  if (legacyError) throw legacyError;
  return legacyUpsells || [];
}

/**
 * POST /api/upsell/offer
 */
router.post('/offer', async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    let session = await paymentService.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'PAYMENT_CONFIRMED') {
      session = await paymentService.beginUpsell(session_id);
    }

    if (['UPSELL_ACCEPTED', 'UPSELL_DECLINED', 'DELIVERED'].includes(session.status)) {
      const delivery = await deliveryService.getOrCreateDelivery(session_id);
      return res.json({
        session_id,
        status: session.status,
        upsells: [],
        delivery_token: delivery.delivery_token,
      });
    }

    if (session.status !== 'UPSELL_PENDING') {
      return res.status(400).json({
        error: `Invalid state: ${session.status}`,
      });
    }

    const upsells = await loadUpsellRules(session.product_id);

    await trackingService.trackEvent('upsell_viewed', {
      session_id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    if (!upsells.length) {
      const declined = await paymentService.transitionState(session_id, 'UPSELL_DECLINED', {
        upsell_status: 'declined',
      });
      const delivery = await deliveryService.getOrCreateDelivery(session_id);

      await trackingService.trackEvent('upsell_declined', {
        session_id,
        customer_email: session.customer_email,
        product_id: session.product_id,
        metadata: { reason: 'no_active_upsells' },
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
      });

      return res.json({
        session_id,
        status: declined.status,
        upsells: [],
        delivery_token: delivery.delivery_token,
        expires_at: declined.upsell_expires_at,
      });
    }

    return res.json({
      session_id,
      status: session.status,
      upsells,
      expires_at: session.upsell_expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    errorsLogger.error('Upsell offer error', { error: err.message });
    return res.status(500).json({ error: 'Failed to get upsell offer' });
  }
});

/**
 * POST /api/upsell/respond
 */
router.post('/respond', validateUpsell, async (req, res) => {
  try {
    const { session_id, action } = req.body;

    const session = await paymentService.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'UPSELL_PENDING') {
      return res.status(400).json({
        error: `Invalid state: ${session.status}`,
      });
    }

    const now = Date.now();
    const expiresAt = session.upsell_expires_at ? new Date(session.upsell_expires_at).getTime() : now + 1;
    const finalAction = now > expiresAt ? 'decline' : action;
    const nextStatus = finalAction === 'accept' ? 'UPSELL_ACCEPTED' : 'UPSELL_DECLINED';

    const updated = await paymentService.transitionState(session_id, nextStatus, {
      upsell_status: now > expiresAt ? 'timed_out' : undefined,
    });

    const eventName = finalAction === 'accept' ? 'upsell_accepted' : 'upsell_declined';
    await trackingService.trackEvent(eventName, {
      session_id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      metadata: {
        requested_action: action,
        final_action: finalAction,
        expired: now > expiresAt,
      },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    const delivery = await deliveryService.getOrCreateDelivery(session_id);

    return res.json({
      status: updated.status,
      session_id,
      delivery_token: delivery.delivery_token,
      message: finalAction === 'accept' ? 'Upsell accepted' : 'Upsell declined',
    });
  } catch (err) {
    errorsLogger.error('Upsell respond error', { error: err.message });
    return res.status(500).json({ error: 'Failed to process upsell response' });
  }
});

/**
 * GET /api/upsell/status/:session_id
 */
router.get('/status/:session_id', async (req, res) => {
  try {
    const session = await paymentService.getSession(req.params.session_id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({
      session_id: session.id,
      status: session.status,
      upsell_status: session.upsell_status,
      upsell_expires_at: session.upsell_expires_at,
      delivery_token: session.delivery_token || null,
    });
  } catch (err) {
    errorsLogger.error('Upsell status error', { error: err.message });
    return res.status(500).json({ error: 'Failed to get upsell status' });
  }
});

module.exports = router;
