const express = require('express');
const router = express.Router();
const trackingService = require('../services/trackingService');
const { applicationLogger, errorsLogger } = require('../config/logger');

// GET /api/tracking/events - Get events with filters
router.get('/events', async (req, res) => {
  try {
    const filters = {
      event_name: req.query.event_name,
      session_id: req.query.session_id,
      customer_email: req.query.customer_email,
      product_id: req.query.product_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    };

    const result = await trackingService.getEvents(filters);
    res.json({
      data: result.data,
      total: result.count,
      limit: filters.limit,
      offset: filters.offset,
    });
  } catch (err) {
    errorsLogger.error('Failed to get events', { error: err.message });
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// GET /api/tracking/session/:sessionId/events - Get events for a session
router.get('/session/:sessionId/events', async (req, res) => {
  try {
    const events = await trackingService.getSessionEvents(req.params.sessionId);
    res.json(events);
  } catch (err) {
    errorsLogger.error('Failed to get session events', { error: err.message });
    res.status(500).json({ error: 'Failed to get session events' });
  }
});

// GET /api/tracking/stats - Get event statistics
router.get('/stats', async (req, res) => {
  try {
    const startDate = req.query.start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();

    const stats = await trackingService.getEventStats(startDate, endDate);
    res.json(stats);
  } catch (err) {
    errorsLogger.error('Failed to get stats', { error: err.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// GET /api/tracking/funnel - Get funnel statistics
router.get('/funnel', async (req, res) => {
  try {
    const startDate = req.query.start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();

    const stats = await trackingService.getFunnelStats(startDate, endDate);
    res.json(stats);
  } catch (err) {
    errorsLogger.error('Failed to get funnel stats', { error: err.message });
    res.status(500).json({ error: 'Failed to get funnel stats' });
  }
});

module.exports = router;
