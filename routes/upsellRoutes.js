const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const paymentService = require('../services/paymentService');
const deliveryService = require('../services/deliveryService');
const trackingService = require('../services/trackingService');
const { validateUpsell } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

// POST /api/upsell/offer - Get upsell offer for session
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

    // Only show upsell if PAYMENT_CONFIRMED
    if (session.status !== 'PAYMENT_CONFIRMED') {
      return res.status(400).json({ error: `Cannot offer upsell: session is ${session.status}` });
    }

    // Transition to UPSELL_PENDING
    await paymentService.transitionState(session_id, 'UPSELL_PENDING');

    // Get upsell products for this product
    const { data: upsells, error } = await supabase
      .from('upsells')
      .select('*, products:product_id(name, price, description, content_type)')
      .eq('main_product_id', session.product_id)
      .eq('is_active', true);

    if (error) throw error;

    // Track event
    await trackingService.trackEvent('upsell_viewed', {
      session_id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    res.json({
      session_id,
      upsells: upsells || [],
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min timeout
    });
  } catch (err) {
    errorsLogger.error('Upsell offer error', { error: err.message });
    res.status(500).json({ error: 'Failed to get upsell offer' });
  }
});

// POST /api/upsell/respond - Accept or decline upsell
router.post('/respond', validateUpsell, async (req, res) => {
  try {
    const { session_id, action } = req.body;

    const session = await paymentService.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'UPSELL_PENDING') {
      return res.status(400).json({ error: `Cannot respond: session is ${session.status}` });
    }

    if (action === 'accept') {
      await paymentService.transitionState(session_id, 'UPSELL_ACCEPTED');
      
      await trackingService.trackEvent('upsell_accepted', {
        session_id,
        customer_email: session.customer_email,
        product_id: session.product_id,
        ip_address: req.ip,
      });

      // Unlock delivery
      const delivery = await deliveryService.unlockDelivery(session_id);

      res.json({
        status: 'UPSELL_ACCEPTED',
        session_id,
        delivery_token: delivery.delivery_token,
        message: 'Upsell accepted, delivery unlocked',
      });
    } else {
      await paymentService.transitionState(session_id, 'UPSELL_DECLINED');
      
      await trackingService.trackEvent('upsell_declined', {
        session_id,
        customer_email: session.customer_email,
        product_id: session.product_id,
        ip_address: req.ip,
      });

      // Unlock delivery anyway
      const delivery = await deliveryService.unlockDelivery(session_id);

      res.json({
        status: 'UPSELL_DECLINED',
        session_id,
        delivery_token: delivery.delivery_token,
        message: 'Upsell declined, delivery unlocked',
      });
    }
  } catch (err) {
    errorsLogger.error('Upsell respond error', { error: err.message });
    res.status(500).json({ error: 'Failed to process upsell response' });
  }
});

// GET /api/upsell/status/:session_id - Get upsell status
router.get('/status/:session_id', async (req, res) => {
  try {
    const session = await paymentService.getSession(req.params.session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      session_id: session.id,
      status: session.status,
      upsell_status: session.upsell_status,
      payment_confirmed: !!session.payment_confirmed_at,
      delivery_unlocked: !!session.delivery_unlocked_at,
    });
  } catch (err) {
    errorsLogger.error('Upsell status error', { error: err.message });
    res.status(500).json({ error: 'Failed to get upsell status' });
  }
});

module.exports = router;
