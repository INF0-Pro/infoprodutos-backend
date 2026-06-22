const express = require('express');
const router = express.Router();
const funnelService = require('../services/funnelService');
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { errorsLogger } = require('../config/logger');

const validateFunnel = [
  body('name').trim().notEmpty().withMessage('Funnel name is required'),
  body('main_product_id').isUUID().withMessage('Valid main product ID required'),
  body('checkout_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid checkout ID required'),
  body('recovery_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Valid recovery URL required'),
  body('upsell_product_ids').optional().isArray().withMessage('upsell_product_ids must be an array'),
  body('upsell_product_ids.*').optional().isUUID().withMessage('Valid upsell product ID required'),
  body('downsell_product_ids').optional().isArray().withMessage('downsell_product_ids must be an array'),
  body('downsell_product_ids.*').optional().isUUID().withMessage('Valid downsell product ID required'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid funnel status'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array().map(e => ({ field: e.path, message: e.msg })),
      });
    }
    next();
  },
];

router.get('/', authenticateToken, async (req, res) => {
  try {
    const data = await funnelService.list();
    return res.json(data);
  } catch (err) {
    errorsLogger.error('Funnel list error', { error: err.message });
    return res.status(500).json({ error: 'Failed to list funnels' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await funnelService.getById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Funnel not found' });
    return res.json(data);
  } catch (err) {
    errorsLogger.error('Funnel get error', { error: err.message, funnelId: req.params.id });
    return res.status(500).json({ error: 'Failed to get funnel' });
  }
});

router.post('/', authenticateToken, validateFunnel, async (req, res) => {
  try {
    const data = await funnelService.create(req.body);
    return res.status(201).json(data);
  } catch (err) {
    errorsLogger.error('Funnel create error', { error: err.message });
    return res.status(500).json({ error: 'Failed to create funnel' });
  }
});

router.put('/:id', authenticateToken, validateFunnel, async (req, res) => {
  try {
    const data = await funnelService.update(req.params.id, req.body);
    return res.json(data);
  } catch (err) {
    errorsLogger.error('Funnel update error', { error: err.message, funnelId: req.params.id });
    return res.status(500).json({ error: 'Failed to update funnel' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await funnelService.delete(req.params.id);
    return res.json({ message: 'Funnel deleted', id: req.params.id });
  } catch (err) {
    errorsLogger.error('Funnel delete error', { error: err.message, funnelId: req.params.id });
    return res.status(500).json({ error: 'Failed to delete funnel' });
  }
});

module.exports = router;
