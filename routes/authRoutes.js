const express = require('express');
const router = express.Router();

const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

/**
 * 🔐 LOGIN
 */
router.post('/login', validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await authService.login(email, password);

    applicationLogger.info('User login success', {
      userId: result?.user?.id,
      email
    });

    return res.json(result);

  } catch (err) {
    const isAuthError = err.message?.toLowerCase().includes('invalid');

    errorsLogger.error('Login error', {
      error: err.message,
      email
    });

    return res.status(isAuthError ? 401 : 500).json({
      error: isAuthError ? 'Invalid credentials' : 'Login failed'
    });
  }
});

/**
 * 🔄 REFRESH TOKEN
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const result = await authService.refreshAccessToken(refreshToken);

    applicationLogger.info('Token refreshed', {
      userId: result?.user?.id
    });

    return res.json(result);

  } catch (err) {
    errorsLogger.error('Refresh error', {
      error: err.message
    });

    return res.status(401).json({
      error: 'Invalid refresh token'
    });
  }
});

/**
 * 🚪 LOGOUT
 */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await authService.logout(req.user.id);

    applicationLogger.info('User logout', {
      userId: req.user.id
    });

    return res.json({ message: 'Logged out successfully' });

  } catch (err) {
    errorsLogger.error('Logout error', {
      error: err.message,
      userId: req.user?.id
    });

    return res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * 👤 ME (REFRESHED OPTIONAL)
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    // opcional: garantir dados frescos do DB
    const user = await authService.getUserById(req.user.id);

    return res.json({ user });

  } catch (err) {
    errorsLogger.error('Me error', {
      error: err.message,
      userId: req.user?.id
    });

    return res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;