const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const PaymentService = require('../services/paymentService');
const trackingService = require('../services/trackingService');

/**
 * GET /api/public/checkout/:checkoutId?product_id=:productId
 */
router.get('/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    const requestedProductId = req.query.product_id || req.query.productId || null;

    const { data: checkout, error } = await supabase
      .from('checkouts')
      .select('*')
      .eq('id', checkoutId)
      .maybeSingle();

    if (error || !checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    if (checkout.status !== 'active') {
      return res.status(400).json({ error: 'Checkout is not active' });
    }

    let productId = requestedProductId;

    if (!productId) {
      const { data: linked } = await supabase
        .from('product_checkouts')
        .select('product_id')
        .eq('checkout_id', checkoutId)
        .eq('is_default', true)
        .maybeSingle();

      productId = linked?.product_id || checkout.product_id || null;
    }

    if (!productId) {
      return res.status(400).json({
        error: 'Product is required for reusable checkout',
      });
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .neq('status', 'deleted')
      .maybeSingle();

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const session = await PaymentService.createSession({
      checkout_id: checkout.id,
      product_id: product.id,
      customer_name: req.query.name || 'Cliente',
      customer_email: req.query.email || `guest_${uuidv4()}@system.local`,
      customer_phone: req.query.phone || null,
      expected_amount: product.price,
      selected_order_bumps: [],
      utm_data: req.query || {},
      is_guest: true,
    });

    await trackingService.trackEvent('checkout_opened', {
      session_id: session.id,
      checkout_id: checkout.id,
      product_id: product.id,
      metadata: { checkout_id: checkout.id, utm: req.query || {} },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
    });

    return res.json({
      checkout: {
        id: checkout.id,
        name: checkout.name,
        description: checkout.description,
        entity: checkout.entity,
        reference: checkout.reference,
        product,
      },
      product,
      session: {
        id: session.id,
        status: session.status,
        expires_at: session.expires_at,
      },
      payment: {
        entity: checkout.entity,
        reference: checkout.reference,
        amount: product.price,
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
