const express = require('express');
const router = express.Router();

const paymentService = require('../services/paymentService');
const trackingService = require('../services/trackingService');

const { authenticateToken } = require('../middleware/auth');
const { validatePaymentSession } = require('../middleware/validation');
const { errorsLogger } = require('../config/logger');

/* ============================================================
   SAFE TRACKING WRAPPER
============================================================ */
async function safeTrack(event, payload) {
  try {
    await trackingService.trackEvent(event, payload);
  } catch (e) {
    errorsLogger.error('Tracking failed', { error: e.message });
  }
}

/* ============================================================
   CREATE SESSION
============================================================ */
router.post('/session', validatePaymentSession, async (req, res) => {
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

    await safeTrack('payment_session_created', {
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

/* ============================================================
   OPEN CHECKOUT
============================================================ */
router.post('/session/:id/open', async (req, res) => {
  try {
    if (!req.params.id) return res.status(400).json({ error: 'Invalid session id' });

    const session = await paymentService.openCheckout(req.params.id);

    await safeTrack('checkout_opened', {
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

/* ============================================================
   START PAYMENT
============================================================ */
router.post('/session/:id/start-payment', async (req, res) => {
  try {
    const session = await paymentService.startPayment(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Start payment error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed' });
  }
});

/* ============================================================
   WAIT PAYMENT
============================================================ */
router.post('/session/:id/wait-payment', async (req, res) => {
  try {
    const session = await paymentService.waitPayment(req.params.id);
    res.json(session);
  } catch (err) {
    errorsLogger.error('Wait payment error', { error: err.message });
    res.status(400).json({ error: err.message || 'Failed' });
  }
});

/* ============================================================
   GET SESSION
============================================================ */
router.get('/session/:id', async (req, res) => {
  try {
    const session = await paymentService.getSession(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);

  } catch (err) {
    errorsLogger.error('Get session error', { error: err.message });
    res.status(500).json({ error: 'Internal error' });
  }
});

/* ============================================================
   COPY TRACKING
============================================================ */
router.post('/session/:id/copy-entity', async (req, res) => {
  try {
    const session = await paymentService.copyEntity(req.params.id);

    await safeTrack('entity_copied', {
      session_id: session.id,
      customer_email: session.customer_email,
      ip_address: req.ip,
    });

    res.json(session);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/:id/copy-reference', async (req, res) => {
  try {
    const session = await paymentService.copyReference(req.params.id);

    await safeTrack('reference_copied', {
      session_id: session.id,
      ip_address: req.ip,
    });

    res.json(session);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/:id/copy-value', async (req, res) => {
  try {
    const session = await paymentService.copyValue(req.params.id);

    await safeTrack('value_copied', {
      session_id: session.id,
      ip_address: req.ip,
    });

    res.json(session);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   ACTIVITY
============================================================ */
router.post('/session/:id/activity', async (req, res) => {
  try {
    const session = await paymentService.updateActivity(req.params.id);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   EXPIRE
============================================================ */
router.post('/session/:id/expire', async (req, res) => {
  try {
    const session = await paymentService.forceExpire(req.params.id);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   ADMIN - REVIEW
============================================================ */
router.get('/review-required', authenticateToken, async (req, res) => {
  try {
    const sessions = await paymentService.getReviewRequiredSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load review sessions' });
  }
});

/* ============================================================
   ADMIN - RESOLVE REVIEW
============================================================ */
router.post('/session/:id/resolve-review', authenticateToken, async (req, res) => {
  try {
    const { action, justification } = req.body;

    if (!['confirm', 'fail'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (!justification || justification.length < 10) {
      return res.status(400).json({ error: 'Justification required' });
    }

    const session = await paymentService.resolveReview(
      req.params.id,
      action,
      justification
    );

    res.json(session);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ============================================================
   ADMIN - LIST SESSIONS
============================================================ */
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await paymentService.listSessions({
      status: req.query.status,
      email: req.query.email,
      product_id: req.query.product_id,
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
    });

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

module.exports = router;