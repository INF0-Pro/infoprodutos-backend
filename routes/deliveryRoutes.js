const express = require('express');
const router = express.Router();
const deliveryService = require('../services/deliveryService');
const trackingService = require('../services/trackingService');
const { errorsLogger } = require('../config/logger');

// GET /api/delivery/:token - Access delivery by token
router.get('/:token', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found or invalid token' });
    }

    // Check if expired
    if (new Date(delivery.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Delivery link has expired' });
    }

    // Track event
    await trackingService.trackEvent('delivery_opened', {
      session_id: delivery.session_id,
      customer_email: delivery.customer_email,
      product_id: delivery.product_id,
      ip_address: req.ip,
    });

    res.json({
      id: delivery.id,
      session_id: delivery.session_id,
      content_type: delivery.content_type,
      content_url: delivery.content_url,
      product: delivery.products,
      downloaded: !!delivery.downloaded_at,
      download_count: delivery.download_count || 0,
    });
  } catch (err) {
    errorsLogger.error('Delivery access error', { error: err.message });
    res.status(500).json({ error: 'Failed to access delivery' });
  }
});

// GET /api/delivery/:token/validate - Validate delivery token
router.get('/:token/validate', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);
    if (!delivery) {
      return res.status(404).json({ valid: false, reason: 'Token not found' });
    }

    if (new Date(delivery.expires_at) < new Date()) {
      return res.status(410).json({ valid: false, reason: 'Token expired' });
    }

    res.json({ valid: true, delivery });
  } catch (err) {
    errorsLogger.error('Delivery validation error', { error: err.message });
    res.status(500).json({ valid: false, reason: 'Validation failed' });
  }
});

// POST /api/delivery/:token/download - Record download
router.post('/:token/download', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);
    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    await deliveryService.recordDownload(delivery.id, req.ip);

    await trackingService.trackEvent('product_downloaded', {
      session_id: delivery.session_id,
      customer_email: delivery.customer_email,
      product_id: delivery.product_id,
      ip_address: req.ip,
    });

    // If content_type is 'link', redirect
    if (delivery.content_type === 'link' && delivery.content_url) {
      return res.json({ redirect: delivery.content_url });
    }

    // If content_type is 'ebook', serve file or return URL
    res.json({
      content_type: delivery.content_type,
      content_url: delivery.content_url,
      message: 'Download recorded',
    });
  } catch (err) {
    errorsLogger.error('Download error', { error: err.message });
    res.status(500).json({ error: 'Failed to process download' });
  }
});

module.exports = router;
