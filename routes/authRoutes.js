const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validation');
const { applicationLogger, errorsLogger } = require('../config/logger');

// POST /api/auth/login
router.post('/login', validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    errorsLogger.error('Login route error', { error: err.message });
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    const result = await authService.refreshAccessToken(refreshToken);
    res.json(result);
  } catch (err) {
    errorsLogger.error('Refresh route error', { error: err.message });
    res.status(401).json({ error: err.message || 'Token refresh failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await authService.logout(req.user.id);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    errorsLogger.error('Logout route error', { error: err.message });
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
