const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const trackingService = require('../services/trackingService');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { validatePaymentSession } = require('../middleware/validation');
const { errorsLogger } = require('../config/logger');

// POST /api/payments/session - Create payment session
router.post('/session', optionalAuth, validatePaymentSession, async (req, res) => {
  try {
    const session = await paymentService.createSession({
      product_id: req.body.product_id,
      checkout_id: req.body.checkout_id,
      customer_name: req.body.customer_name,
      customer_email: req.body.customer_email,
      customer_phone: req.body.customer_phone,
      expected_amount: req.body.expected_amount,
      selected_order_bumps: req.body.selected_order_bumps,
      utm_data: req.body.utm_data,
    });

    // Track event
    await trackingService.trackEvent('payment_session_created', {
      session_id: session.id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    res.status(201).json(session);
  } catch (err) {
    errorsLogger.error('Create session error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to create session' });
  }
});

// POST /api/payments/session/:id/open - Open checkout
router.post('/session/:id/open', async (req, res) => {
  try {
    const session = await paymentService.openCheckout(req.params.id);
    
    await trackingService.trackEvent('checkout_opened', {
      session_id: session.id,
      customer_email: session.customer_email,
      ip_address: req.ip,
    });

    res.json(session);
  } catch (err) {
    errorsLogger.error('Open checkout error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to open checkout' });
  }
});

// POST /api/payments/session/:id/start-payment - Start payment
router.post('/session/:id/start-payment', async (req, res) => {
  try {
    const session = await paymentService.startPayment(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Start payment error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to start payment' });
  }
});

// POST /api/payments/session/:id/wait-payment - Wait for payment
router.post('/session/:id/wait-payment', async (req, res) => {
  try {
    const session = await paymentService.waitPayment(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Wait payment error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to set waiting payment' });
  }
});

// GET /api/payments/session/:id - Get session
router.get('/session/:id', async (req, res) => {
  try {
    const session = await paymentService.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (err) {
    errorsLogger.error('Get session error', { error: err.message });
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// POST /api/payments/session/:id/copy-entity - Register entity copy
router.post('/session/:id/copy-entity', async (req, res) => {
  try {
    const session = await paymentService.copyEntity(req.params.id);
    
    await trackingService.trackEvent('entity_copied', {
      session_id: session.id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    res.json(session);
  } catch (err) {
    errorsLogger.error('Copy entity error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to register copy' });
  }
});

// POST /api/payments/session/:id/copy-reference - Register reference copy
router.post('/session/:id/copy-reference', async (req, res) => {
  try {
    const session = await paymentService.copyReference(req.params.id);
    
    await trackingService.trackEvent('reference_copied', {
      session_id: session.id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    res.json(session);
  } catch (err) {
    errorsLogger.error('Copy reference error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to register copy' });
  }
});

// POST /api/payments/session/:id/copy-value - Register value copy
router.post('/session/:id/copy-value', async (req, res) => {
  try {
    const session = await paymentService.copyValue(req.params.id);
    
    await trackingService.trackEvent('value_copied', {
      session_id: session.id,
      customer_email: session.customer_email,
      product_id: session.product_id,
      ip_address: req.ip,
    });

    res.json(session);
  } catch (err) {
    errorsLogger.error('Copy value error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to register copy' });
  }
});

// POST /api/payments/session/:id/activity - Update activity
router.post('/session/:id/activity', async (req, res) => {
  try {
    const session = await paymentService.updateActivity(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Update activity error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to update activity' });
  }
});

// POST /api/payments/session/:id/expire - Force expire session
router.post('/session/:id/expire', async (req, res) => {
  try {
    const session = await paymentService.forceExpire(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Force expire error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to expire session' });
  }
});

// GET /api/payments/review-required - List sessions needing review (admin)
router.get('/review-required', authenticateToken, async (req, res) => {
  try {
    const sessions = await paymentService.getReviewRequiredSessions();
    res.json(sessions);
  } catch (err) {
    errorsLogger.error('List review required error', { error: err.message });
    res.status(500).json({ error: 'Failed to list review sessions' });
  }
});

// POST /api/payments/session/:id/resolve-review - Resolve a review (admin)
router.post('/session/:id/resolve-review', authenticateToken, async (req, res) => {
  try {
    const { action, justification } = req.body;
    if (!action || !['confirm', 'cancel', 'fail'].includes(action)) {
      return res.status(400).json({ error: 'Action must be: confirm, cancel, or fail' });
    }
    if (!justification || justification.trim().length < 10) {
      return res.status(400).json({ error: 'Justification required (min 10 characters)' });
    }

    const session = await paymentService.resolveReview(req.params.id, action, justification);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Resolve review error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed to resolve review' });
  }
});

// GET /api/payments/sessions - List sessions (admin)
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      email: req.query.email,
      product_id: req.query.product_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
    };

    const result = await paymentService.listSessions(filters);
    res.json(result);
  } catch (err) {
    errorsLogger.error('List sessions error', { error: err.message });
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

module.exports = router;
