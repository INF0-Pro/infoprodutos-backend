require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { applicationLogger, errorsLogger } = require('./config/logger');

// Routes
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const upsellRoutes = require('./routes/upsellRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const diagnosticsRoutes = require('./routes/diagnosticsRoutes');

// Workers
const paymentWorker = require('./jobs/paymentWorker');
const deliveryWorker = require('./jobs/deliveryWorker');
const trackingWorker = require('./jobs/trackingWorker');
const upsellWorker = require('./jobs/upsellWorker');
const recoveryWorker = require('./jobs/recoveryWorker');
const expirationWorker = require('./jobs/expirationWorker');

const app = express();
const PORT = process.env.PORT || 3000;

// === SECURITY MIDDLEWARE ===
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  applicationLogger.http(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  next();
});

// === STATIC FILES (Frontend) ===
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// === API ROUTES ===
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/checkouts', checkoutRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/upsell', upsellRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// === ERROR HANDLING ===
app.use((err, req, res, next) => {
  errorsLogger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// === START SERVER ===
async function startServer() {
  try {
    app.listen(PORT, () => {
      applicationLogger.info(`Server started on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        corsOrigin: process.env.CORS_ORIGIN,
      });

      // Start workers
      if (process.env.ENABLE_WORKERS === 'true') {
  paymentWorker.start();
  deliveryWorker.start();
  trackingWorker.start();
  upsellWorker.start();
  recoveryWorker.start();
  expirationWorker.start();
}

      if (process.env.ENABLE_WORKERS === 'true') {
  recoveryWorker.recoverSystem().catch(err => {
    errorsLogger.error('Startup recovery failed', { error: err.message });
  });
}
    });
  } catch (err) {
    errorsLogger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

startServer();

module.exports = app;
