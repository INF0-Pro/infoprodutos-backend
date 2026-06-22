const express = require('express');
const router = express.Router();

const { supabase } = require('../config/database');
const { applicationLogger, errorsLogger } = require('../config/logger');

/**
 * 🧪 DIAGNOSTICS SYSTEM
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  const results = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {},
  };

  try {
    /**
     * 🔌 Supabase connectivity (lightweight)
     */
    const { error: connError } = await supabase
      .from('products')
      .select('id', { head: true, count: 'exact' })
      .limit(1);

    results.checks.supabase = {
      status: connError ? 'error' : 'ok',
      message: connError?.message || 'Connected'
    };

  } catch (err) {
    results.checks.supabase = {
      status: 'error',
      message: err.message
    };
  }

  /**
   * 📊 Table existence check (lightweight version)
   */
  const tables = [
    'users',
    'products',
    'checkouts',
    'payment_sessions',
    'deliveries',
    'upsells',
    'tracking_events'
  ];

  results.checks.tables = {};

  for (const table of tables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('id', { head: true })
        .limit(1);

      results.checks.tables[table] = {
        status: error ? 'error' : 'ok'
      };

    } catch (err) {
      results.checks.tables[table] = {
        status: 'error'
      };
    }
  }

  /**
   * ⚙️ Environment validation (improved)
   */
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ];

  results.checks.environment = {};

  for (const v of requiredVars) {
    const value = process.env[v];

    results.checks.environment[v] = {
      status: value ? 'ok' : 'missing',
      valid: value ? value.length > 10 : false
    };
  }

  /**
   * 📌 FIXED overall status logic
   */
  const tableStatusOk = Object.values(results.checks.tables)
    .every(t => t.status === 'ok');

  const envStatusOk = Object.values(results.checks.environment)
    .every(e => e.status === 'ok');

  const dbStatusOk = results.checks.supabase.status === 'ok';

  results.overall_status =
    dbStatusOk && tableStatusOk && envStatusOk
      ? 'healthy'
      : 'degraded';

  results.duration_ms = Date.now() - start;

  applicationLogger.info('Diagnostics executed', {
    status: results.overall_status,
    duration_ms: results.duration_ms
  });

  return res.json(results);
});

module.exports = router;