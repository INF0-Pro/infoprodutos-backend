const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { validateWebhook } = require('../middleware/validation');
const { macrodroidLogger, errorsLogger } = require('../config/logger');

// POST /api/webhook/macrodroid/payment - MacroDroid payment notification
router.post('/macrodroid/payment', validateWebhook, async (req, res) => {
  // Verify webhook token
  const token = req.headers['x-webhook-token'];
  if (!token || token !== process.env.MACRODROID_WEBHOOK_TOKEN) {
    macrodroidLogger.warn('Invalid webhook token attempt', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid webhook token' });
  }

  try {
    const result = await paymentService.processPaymentWebhook({
      amount: req.body.amount,
      entity: req.body.entity,
      reference: req.body.reference,
      received_at: req.body.received_at,
      raw_message: req.body.raw_message,
      sender: req.body.sender,
    });

    macrodroidLogger.info('Webhook processed', { result });
    res.json(result);
  } catch (err) {
    errorsLogger.error('Webhook processing error', { error: err.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /api/webhook/macrodroid/debug - Debug payment processing (dry run)
router.post('/macrodroid/debug', async (req, res) => {
  try {
    const result = await paymentService.debugProcessPayment({
      amount: req.body.amount,
      entity: req.body.entity,
      reference: req.body.reference,
    });

    macrodroidLogger.info('Webhook debug processed', { result });
    res.json(result);
  } catch (err) {
    errorsLogger.error('Webhook debug error', { error: err.message });
    res.status(500).json({ error: 'Debug processing failed' });
  }
});

// GET /api/webhook/health - Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
