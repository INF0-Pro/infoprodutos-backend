const express = require('express');
const router = express.Router();

const checkoutService = require('../services/checkoutService');
const { authenticateToken } = require('../middleware/auth');
const { validateCheckout } = require('../middleware/validation');
const { errorsLogger } = require('../config/logger');

// GET all
router.get('/', async (req, res) => {
  try {
    const data = await checkoutService.list();
    res.json(data);
  } catch (err) {
    errorsLogger.error(err.message);
    res.status(500).json({ error: 'Failed to list checkouts' });
  }
});

// GET by id
router.get('/:id', async (req, res) => {
  try {
    const data = await checkoutService.getById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Checkout not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get checkout' });
  }
});

// CREATE
router.post('/', authenticateToken, validateCheckout, async (req, res) => {
  try {
    const data = await checkoutService.create(req.body);
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create checkout' });
  }
});

// UPDATE
router.put('/:id', authenticateToken, validateCheckout, async (req, res) => {
  try {
    const data = await checkoutService.update(req.params.id, req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update checkout' });
  }
});

// DELETE
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await checkoutService.delete(req.params.id);
    res.json({ message: 'Checkout deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete checkout' });
  }
});

module.exports = router;