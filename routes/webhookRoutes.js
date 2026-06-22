const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { validateWebhook } = require('../middleware/validation');
const { macrodroidLogger, errorsLogger } = require('../config/logger');

// POST /api/webhook/macrodroid/payment
router.post('/macrodroid/payment', validateWebhook, async (req, res) => {
  const token = req.headers['x-webhook-token'];

  if (!token || token !== process.env.MACRODROID_WEBHOOK_TOKEN) {
    macrodroidLogger.warn('Invalid webhook token attempt', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid webhook token' });
  }

  try {
    const payload = {
      amount: req.body.amount,
      entity: req.body.entity,
      reference: req.body.reference,
      received_at: req.body.received_at,
      raw_message: req.body.raw_message,
      sender: req.body.sender,
      sim_slot: req.body.sim_slot || null,
      payment_channel_id: req.body.payment_channel_id || null
    };

    /**
     * 🔥 PASSO 5.3.3 — FINGERPRINT + LOCK
     */
    const fingerprint = paymentService.generateFingerprint(payload);

    const lock = await paymentService.checkAndLockPaymentEvent(
      fingerprint,
      payload
    );

    // 🔴 DUPLICADO → ignorar totalmente
    if (lock.ignored) {
      macrodroidLogger.info('Duplicate payment ignored', {
        fingerprint
      });

      return res.json({
        status: 'duplicate_ignored'
      });
    }

    /**
     * 🔥 PROCESSAMENTO NORMAL
     */
    const result = await paymentService.processPaymentWebhook(payload);

    macrodroidLogger.info('Webhook processed', {
      result,
      fingerprint
    });

    res.json(result);

  } catch (err) {
    errorsLogger.error('Webhook processing error', {
      error: err.message
    });

    res.status(500).json({
      error: 'Webhook processing failed'
    });
  }
});

// DEBUG
router.post('/macrodroid/debug', async (req, res) => {
  try {
    const result = await paymentService.processPaymentWebhook({
      amount: req.body.amount,
      entity: req.body.entity,
      reference: req.body.reference,
      sim_slot: req.body.sim_slot || null,
      payment_channel_id: req.body.payment_channel_id || null
    });

    macrodroidLogger.info('Webhook debug processed', { result });

    res.json(result);

  } catch (err) {
    errorsLogger.error('Webhook debug error', {
      error: err.message
    });

    res.status(500).json({
      error: 'Debug processing failed'
    });
  }
});

// HEALTH
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;