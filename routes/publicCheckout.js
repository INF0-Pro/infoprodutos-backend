const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const PaymentService = require('../services/paymentService');
const trackingService = require('../services/trackingService');

/**
 * PUBLIC CHECKOUT
 * GET /api/public/checkout/:checkoutId
 */
router.get('/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;

    // 1. Buscar checkout
    const { data: checkout, error } = await supabase
      .from('checkouts')
      .select('*, products:product_id(name, price)')
      .eq('id', checkoutId)
      .maybeSingle();

    if (error || !checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    if (checkout.status !== 'active') {
      return res.status(400).json({ error: 'Checkout is not active' });
    }

    const amount = checkout.products?.price;

    if (typeof amount !== 'number') {
      return res.status(500).json({ error: 'Invalid product price configuration' });
    }

    // 2. Criar sessão
    const session = await PaymentService.createSession({
      checkout_id: checkout.id,
      product_id: checkout.product_id,

      customer_name: null,
      customer_email: `guest_${uuidv4()}@system.local`,
      customer_phone: null,

      expected_amount: amount,
      selected_order_bumps: [],
      utm_data: req.query || {},
      is_guest: true,
    });

    // 3. tracking (IMPORTANTE para funil)
    await trackingService.trackEvent('public_checkout_loaded', {
      session_id: session.id,
      checkout_id: checkout.id,
      product_id: checkout.product_id,
      ip_address: req.ip,
    });

    return res.json({
      checkout: {
        id: checkout.id,
        name: checkout.name,
        description: checkout.description,
        entity: checkout.entity,
        reference: checkout.reference,
        product: checkout.products,
      },

      session: {
        id: session.id,
        status: session.status,
        expires_at: session.expires_at,
      },

      payment: {
        entity: checkout.entity,
        reference: checkout.reference,
        amount,
      }
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load checkout',
      message: err.message
    });
  }
});

module.exports = router;