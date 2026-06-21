const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * 📊 OVERVIEW DO SISTEMA
 * KPI principais
 */
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const now = new Date().toISOString();

    const [
      created,
      waiting,
      confirmed,
      expired,
      review
    ] = await Promise.all([
      supabase.from('payment_sessions').select('id', { count: 'exact' }).eq('status', 'CREATED'),
      supabase.from('payment_sessions').select('id', { count: 'exact' }).eq('status', 'WAITING_PAYMENT'),
      supabase.from('payment_sessions').select('id', { count: 'exact' }).eq('status', 'PAYMENT_CONFIRMED'),
      supabase.from('payment_sessions').select('id', { count: 'exact' }).eq('status', 'EXPIRED'),
      supabase.from('payment_sessions').select('id', { count: 'exact' }).eq('status', 'REVIEW_REQUIRED'),
    ]);

    res.json({
      created: created.count || 0,
      waiting: waiting.count || 0,
      confirmed: confirmed.count || 0,
      expired: expired.count || 0,
      review: review.count || 0,
      timestamp: now
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

/**
 * 📋 SESSÕES RECENTES
 */
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json(data || []);

  } catch (err) {
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

/**
 * ⚠️ SESSÕES EM REVIEW
 */
router.get('/review', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .eq('status', 'REVIEW_REQUIRED')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);

  } catch (err) {
    res.status(500).json({ error: 'Failed to load review sessions' });
  }
});

module.exports = router;