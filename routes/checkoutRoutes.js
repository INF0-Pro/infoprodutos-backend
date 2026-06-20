const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { validateCheckout } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

// GET /api/checkouts - List all checkouts
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('checkouts')
      .select('*, products:product_id(name, price)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    errorsLogger.error('Failed to list checkouts', { error: err.message });
    res.status(500).json({ error: 'Failed to list checkouts' });
  }
});

// GET /api/checkouts/:id - Get single checkout
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('checkouts')
      .select('*, products:product_id(*)')
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Checkout not found' });
    res.json(data);
  } catch (err) {
    errorsLogger.error('Failed to get checkout', { error: err.message });
    res.status(500).json({ error: 'Failed to get checkout' });
  }
});

// POST /api/checkouts - Create checkout (admin only)
router.post('/', authenticateToken, validateCheckout, async (req, res) => {
  try {
    // Verify product exists and is active
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, status')
      .eq('id', req.body.product_id)
      .single();

    if (productError || !product) {
      return res.status(400).json({ error: 'Product not found' });
    }
    if (product.status !== 'active') {
      return res.status(400).json({ error: 'Product is not active' });
    }

    const checkout = {
      id: uuidv4(),
      name: req.body.name,
      description: req.body.description || '',
      product_id: req.body.product_id,
      entity: req.body.entity,
      reference: req.body.reference,
      checkout_template: req.body.checkout_template || 'default',
      payment_template: req.body.payment_template || 'default',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('checkouts')
      .insert(checkout)
      .select()
      .single();

    if (error) throw error;

    applicationLogger.info('Checkout created', { checkoutId: data.id, name: data.name });
    res.status(201).json(data);
  } catch (err) {
    errorsLogger.error('Failed to create checkout', { error: err.message });
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// PUT /api/checkouts/:id - Update checkout (admin only)
router.put('/:id', authenticateToken, validateCheckout, async (req, res) => {
  try {
    const updates = {
      name: req.body.name,
      description: req.body.description || '',
      product_id: req.body.product_id,
      entity: req.body.entity,
      reference: req.body.reference,
      checkout_template: req.body.checkout_template || 'default',
      payment_template: req.body.payment_template || 'default',
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('checkouts')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(404).json({ error: 'Checkout not found' });
    res.json(data);
  } catch (err) {
    errorsLogger.error('Failed to update checkout', { error: err.message });
    res.status(500).json({ error: 'Failed to update checkout' });
  }
});

// DELETE /api/checkouts/:id - Soft delete checkout
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('checkouts')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) return res.status(404).json({ error: 'Checkout not found' });
    res.json({ message: 'Checkout deleted' });
  } catch (err) {
    errorsLogger.error('Failed to delete checkout', { error: err.message });
    res.status(500).json({ error: 'Failed to delete checkout' });
  }
});

module.exports = router;
