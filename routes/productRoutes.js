const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { validateProduct } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

/**
 * GET /api/products
 * Lista todos os produtos ativos
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id', { ascending: false }); // FIX: evitamos created_at

    if (error) throw error;

    return res.json(data || []);
  } catch (err) {
    errorsLogger.error('Failed to list products', {
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to list products',
    });
  }
});

/**
 * GET /api/products/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    return res.json(data);
  } catch (err) {
    errorsLogger.error('Failed to get product', {
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to get product',
    });
  }
});

/**
 * POST /api/products
 */
router.post('/', authenticateToken, validateProduct, async (req, res) => {
  try {
    const product = {
      id: uuidv4(),
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price,
      content_type: req.body.content_type,
      content_url: req.body.content_url || null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('products')
      .insert(product)
      .select()
      .single();

    if (error) throw error;

    applicationLogger.info('Product created', {
      productId: data.id,
      name: data.name,
    });

    return res.status(201).json(data);
  } catch (err) {
    errorsLogger.error('Failed to create product', {
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to create product',
    });
  }
});

/**
 * PUT /api/products/:id
 */
router.put('/:id', authenticateToken, validateProduct, async (req, res) => {
  try {
    const updates = {
      name: req.body.name,
      description: req.body.description || '',
      price: req.body.price,
      content_type: req.body.content_type,
      content_url: req.body.content_url || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    return res.json(data);
  } catch (err) {
    errorsLogger.error('Failed to update product', {
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to update product',
    });
  }
});

/**
 * DELETE /api/products/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .update({
        status: 'deleted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) {
      return res.status(404).json({
        error: 'Product not found',
      });
    }

    return res.json({
      message: 'Product deleted',
    });
  } catch (err) {
    errorsLogger.error('Failed to delete product', {
      error: err.message,
    });

    return res.status(500).json({
      error: 'Failed to delete product',
    });
  }
});

module.exports = router;
