const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const paymentService = require('../services/paymentService');
const deliveryService = require('../services/deliveryService');
const trackingService = require('../services/trackingService');
const { validateUpsell } = require('../middleware/validation');
const { errorsLogger } = require('../config/logger');

/**
 * POST /api/upsell/offer
 */
router.post('/offer', async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const session = await paymentService.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Bloqueia re-exposição
    if (session.status !== 'PAYMENT_CONFIRMED') {
      return res.status(400).json({
        error: `Invalid state: ${session.status}`,
      });
    }

    if (['UPSELL_ACCEPTED', 'UPSELL_DECLINED'].includes(session.status)) {
      return res.status(400).json({
        error: 'Upsell already resolved',
      });
    }

    // Só marcar pending uma vez
    if (session.upsell_status !== 'PENDING') {
      await paymentService.transitionState(session_id, 'UPSELL_PENDING');
    }

    const { data: upsells, error } = await supabase
      .from('upsells')
      .select('*, products:product_id(name, price, description, content_type)')
      .eq('main_product_id', session.product_id)
      .eq('is_active', true);

    if (error) throw error;

    await trackingService.trackEvent('upsell_viewed', {
      session_id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    return res.json({
      session_id,
      upsells: upsells || [],
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
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

    // Proteção contra double-submit
    if (session.upsell_status === 'RESOLVED') {
      return res.status(400).json({
        error: 'Upsell already resolved',
      });
    }

    let delivery = await deliveryService.getOrCreateDelivery(session_id);

    if (action === 'accept') {
      await paymentService.transitionState(session_id, 'UPSELL_ACCEPTED');

      await trackingService.trackEvent('upsell_accepted', {
        session_id,
        customer_email: session.customer_email,
        product_id: session.product_id,
        ip_address: req.ip,
      });

      return res.json({
        status: 'UPSELL_ACCEPTED',
        session_id,
        delivery_token: delivery.delivery_token,
        message: 'Upsell accepted',
      });
    }

    await paymentService.transitionState(session_id, 'UPSELL_DECLINED');

    await trackingService.trackEvent('upsell_declined', {
      session_id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    return res.json({
      status: 'UPSELL_DECLINED',
      session_id,
      delivery_token: delivery.delivery_token,
      message: 'Upsell declined',
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
    });

  } catch (err) {
    errorsLogger.error('Upsell status error', { error: err.message });
    return res.status(500).json({ error: 'Failed to get upsell status' });
  }
});

module.exports = router;