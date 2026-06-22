const express = require('express');
const router = express.Router();

const checkoutService = require('../services/checkoutService');
const { authenticateToken } = require('../middleware/auth');
const { validateCheckout } = require('../middleware/validation');
const { errorsLogger, applicationLogger } = require('../config/logger');

/**
 * 📋 LISTAR CHECKOUTS (ADMIN)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const data = await checkoutService.list();

    return res.json(data);
  } catch (err) {
    errorsLogger.error('Checkout list error', {
      error: err.message,
      route: '/checkouts'
    });

    return res.status(500).json({ error: 'Failed to list checkouts' });
  }
});

/**
 * 🔍 GET CHECKOUT BY ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await checkoutService.getById(req.params.id);

    if (!data) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    return res.json(data);
  } catch (err) {
    errorsLogger.error('Checkout get error', {
      error: err.message,
      checkoutId: req.params.id
    });

    return res.status(500).json({ error: 'Failed to get checkout' });
  }
});

/**
 * ➕ CREATE CHECKOUT
 */
router.post('/', authenticateToken, validateCheckout, async (req, res) => {
  try {
    const data = await checkoutService.create(req.body);

    applicationLogger.info('Checkout created', {
      checkoutId: data?.id,
      name: data?.name
    });

    return res.status(201).json(data);
  } catch (err) {
    errorsLogger.error('Checkout create error', {
      error: err.message,
      body: req.body
    });

    return res.status(500).json({ error: 'Failed to create checkout' });
  }
});

/**
 * ✏️ UPDATE CHECKOUT
 */
router.put('/:id', authenticateToken, validateCheckout, async (req, res) => {
  try {
    const data = await checkoutService.update(req.params.id, req.body);

    if (!data) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    return res.json(data);
  } catch (err) {
    errorsLogger.error('Checkout update error', {
      error: err.message,
      checkoutId: req.params.id
    });

    return res.status(500).json({ error: 'Failed to update checkout' });
  }
});

/**
 * 🗑 DELETE CHECKOUT (SOFT SAFE)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await checkoutService.delete(req.params.id);

    if (!result) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    return res.json({
      message: 'Checkout deleted',
      id: req.params.id
    });

  } catch (err) {
    errorsLogger.error('Checkout delete error', {
      error: err.message,
      checkoutId: req.params.id
    });

    return res.status(500).json({ error: 'Failed to delete checkout' });
  }
});

module.exports = router;