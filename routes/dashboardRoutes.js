const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * 📊 OVERVIEW DO SISTEMA (KPIs)
 */
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const now = new Date().toISOString();

    const statuses = [
      'CREATED',
      'WAITING_PAYMENT',
      'PAYMENT_CONFIRMED',
      'EXPIRED',
      'REVIEW_REQUIRED'
    ];

    const queries = await Promise.all(
      statuses.map(status =>
        supabase
          .from('payment_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('status', status)
      )
    );

    const result = statuses.reduce((acc, status, index) => {
      acc[status.toLowerCase()] = queries[index].count || 0;
      return acc;
    }, {});

    res.json({
      ...result,
      timestamp: now
    });

  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

/**
 * 📋 SESSÕES RECENTES
 */
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const { data, error } = await supabase
      .from('payment_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('Sessions error:', err);
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
    console.error('Review error:', err);
    res.status(500).json({ error: 'Failed to load review sessions' });
  }
});

module.exports = router;