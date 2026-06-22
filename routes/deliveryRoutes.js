const express = require('express');
const router = express.Router();

const deliveryService = require('../services/deliveryService');
const trackingService = require('../services/trackingService');
const { errorsLogger } = require('../config/logger');

/**
 * 📦 GET DELIVERY BY TOKEN
 */
router.get('/:token', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);

    if (!delivery) {
      return res.status(404).json({ error: 'Invalid delivery token' });
    }

    if (new Date(delivery.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Delivery expired' });
    }

    // tracking NÃO bloqueia UX
    trackingService.trackEvent('delivery_opened', {
      session_id: delivery.session_id,
      product_id: delivery.product_id,
      ip_address: req.ip,
    }).catch(() => {});

    return res.json({
      id: delivery.id,
      session_id: delivery.session_id,
      content_type: delivery.content_type,
      content_url: delivery.content_url,
      product: delivery.products,
      downloaded: !!delivery.downloaded_at,
      download_count: delivery.download_count || 0,
    });

  } catch (err) {
    errorsLogger.error('Delivery access error', {
      error: err.message,
      token: req.params.token
    });

    return res.status(500).json({ error: 'Failed to access delivery' });
  }
});

/**
 * 🔐 VALIDATE TOKEN (SAFE VERSION)
 */
router.get('/:token/validate', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);

    if (!delivery) {
      return res.json({ valid: false, reason: 'not_found' });
    }

    if (new Date(delivery.expires_at) < new Date()) {
      return res.json({ valid: false, reason: 'expired' });
    }

    // NÃO expor delivery completo
    return res.json({
      valid: true,
      content_type: delivery.content_type,
      has_access: true
    });

  } catch (err) {
    errorsLogger.error('Delivery validation error', {
      error: err.message
    });

    return res.status(500).json({
      valid: false,
      reason: 'server_error'
    });
  }
});

/**
 * 📥 DOWNLOAD TRACKING
 */
router.post('/:token/download', async (req, res) => {
  try {
    const delivery = await deliveryService.getDeliveryByToken(req.params.token);

    if (!delivery) {
      return res.status(404).json({ error: 'Invalid delivery' });
    }

    await deliveryService.recordDownload(delivery.id, req.ip);

    // tracking async safe
    trackingService.trackEvent('product_downloaded', {
      session_id: delivery.session_id,
      product_id: delivery.product_id,
      ip_address: req.ip,
    }).catch(() => {});

    // comportamento consistente
    if (delivery.content_type === 'link') {
      return res.json({
        type: 'redirect',
        url: delivery.content_url
      });
    }

    return res.json({
      type: 'download',
      content_type: delivery.content_type,
      content_url: delivery.content_url,
      message: 'Download recorded'
    });

  } catch (err) {
    errorsLogger.error('Download error', {
      error: err.message,
      token: req.params.token
    });

    return res.status(500).json({ error: 'Failed to process download' });
  }
});

module.exports = router;