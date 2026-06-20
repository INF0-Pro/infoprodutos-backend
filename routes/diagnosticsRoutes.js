const express = require('express');
const router = express.Router();

const { supabase } = require('../config/database');
const { applicationLogger, errorsLogger } = require('../config/logger');

// GET /api/diagnostics
router.get('/', async (req, res) => {
  const results = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    workers_enabled: process.env.ENABLE_WORKERS === 'true',
    checks: {},
  };

  // Supabase check
  try {
    const { error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    results.checks.supabase_connection = {
      status: error ? 'error' : 'ok',
      message: error ? error.message : 'Connected successfully',
    };
  } catch (err) {
    results.checks.supabase_connection = {
      status: 'error',
      message: err.message,
    };
  }

  // Tables check
  const tables = [
    'users',
    'products',
    'checkouts',
    'payment_sessions',
    'deliveries',
    'upsells',
    'order_bumps',
    'tracking_events',
    'audit_log'
  ];

  results.checks.tables = {};

  for (const table of tables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      results.checks.tables[table] = {
        status: error ? 'error' : 'ok',
        message: error ? error.message : 'OK',
      };
    } catch (err) {
      results.checks.tables[table] = {
        status: 'error',
        message: err.message,
      };
    }
  }

  // Env check
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ];

  results.checks.environment = {};

  for (const v of requiredVars) {
    results.checks.environment[v] = {
      status: process.env[v] ? 'ok' : 'missing'
    };
  }

  results.overall_status = Object.values(results.checks).every(c =>
    typeof c === 'object' && c.status === 'ok'
  )
    ? 'healthy'
    : 'degraded';

  applicationLogger.info('Diagnostics check executed');

  res.json(results);
});

module.exports = router;
