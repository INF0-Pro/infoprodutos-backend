const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const PaymentService = require('../services/paymentService');

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
      .single();

    if (error || !checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    if (checkout.status !== 'active') {
      return res.status(400).json({ error: 'Checkout is not active' });
    }

    // 2. Criar sessão automaticamente
    const session = await PaymentService.createSession({
      checkout_id: checkout.id,
      product_id: checkout.product_id,

      // ⚠️ sessão “anónima” (vai ser preenchida depois no frontend se quiseres)
      customer_name: 'guest',
      customer_email: `guest_${uuidv4()}@temp.local`,
      customer_phone: null,

      expected_amount: checkout.products?.price || 0,
      selected_order_bumps: [],
      utm_data: null,
    });

    // 3. Resposta pronta para frontend
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
        amount: checkout.products?.price || 0,
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