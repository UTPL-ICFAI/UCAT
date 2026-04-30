import express from 'express';
import pool from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = express.Router();

async function loadUserForLogin(userId) {
  try {
    const result = await pool.query(
      'SELECT id, name, role, password_hash FROM users WHERE user_id = $1',
      [userId]
    );

    return {
      user: result.rows[0] || null,
      passwordField: 'password_hash'
    };
  } catch (error) {
    if (error.code !== '42703') {
      throw error;
    }

    const fallbackResult = await pool.query(
      'SELECT id, name, role, password FROM users WHERE user_id = $1',
      [userId]
    );

    return {
      user: fallbackResult.rows[0] || null,
      passwordField: 'password'
    };
  }
}

router.post('/login', async (req, res) => {
  try {
    const { user_id, password } = req.body;
    
    if (!user_id || !password) {
      return res.status(400).json({ error: 'user_id and password required' });
    }
    
    const { user, passwordField } = await loadUserForLogin(user_id);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const storedSecret = user[passwordField];
    if (!storedSecret) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = storedSecret.startsWith('$2')
      ? await bcrypt.compare(password, storedSecret)
      : password === storedSecret;
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '8h' }
    );
    
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    });
    
    res.json({
      success: true,
      role: user.role,
      name: user.name,
      token: token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

export default router;
