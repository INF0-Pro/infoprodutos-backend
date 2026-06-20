const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { applicationLogger, errorsLogger } = require('../config/logger');

class AuthService {
  async createAdmin(email, password) {
    try {
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const { data, error } = await supabase
        .from('users')
        .insert({
          email,
          password_hash: hashedPassword,
          role: 'admin',
          is_active: true,
        })
        .select('id, email, role, created_at')
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      errorsLogger.error('Failed to create admin', { error: err.message });
      throw err;
    }
  }

  async login(email, password) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (error || !user) {
        throw new Error('Invalid credentials');
      }

      if (!user.is_active) {
        throw new Error('Account deactivated');
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      const accessToken = this.generateAccessToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Store refresh token
      await supabase
        .from('users')
        .update({ refresh_token: refreshToken, last_login_at: new Date().toISOString() })
        .eq('id', user.id);

      applicationLogger.info('User logged in', { userId: user.id, email: user.email });

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      };
    } catch (err) {
      errorsLogger.error('Login failed', { error: err.message });
      throw err;
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('refresh_token', refreshToken)
        .single();

      if (error || !user) {
        throw new Error('Invalid refresh token');
      }

      // Verify the refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      
      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      // Update refresh token
      await supabase
        .from('users')
        .update({ refresh_token: newRefreshToken })
        .eq('id', user.id);

      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (err) {
      errorsLogger.error('Refresh token failed', { error: err.message });
      throw new Error('Invalid or expired refresh token');
    }
  }

  async logout(userId) {
    await supabase
      .from('users')
      .update({ refresh_token: null })
      .eq('id', userId);
  }

  generateAccessToken(user) {
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
  }

  generateRefreshToken(user) {
    return jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
  }
}

module.exports = new AuthService();
