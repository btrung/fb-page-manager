const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const FACEBOOK_CALLBACK_URL = process.env.FACEBOOK_CALLBACK_URL;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Quyền cần xin từ user — phù hợp với Facebook App Review
const SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',       // Xem danh sách pages user quản lý
  'pages_read_engagement', // Đọc posts, likes, comments của page
].join(',');

// =============================================
// GET /auth/facebook
// Bắt đầu OAuth flow — redirect sang Facebook
// =============================================
router.get('/facebook', (req, res) => {
  // Tạo state ngẫu nhiên để chống CSRF
  const state = uuidv4();
  req.session.oauthState = state;

  const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
  authUrl.searchParams.set('redirect_uri', FACEBOOK_CALLBACK_URL);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');

  res.redirect(authUrl.toString());
});

// =============================================
// GET /auth/facebook/callback
// Facebook redirect về đây sau khi user đồng ý
// =============================================
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // User từ chối cấp quyền
  if (error) {
    return res.redirect(`${FRONTEND_URL}/login?error=permission_denied`);
  }

  // Kiểm tra state để chống CSRF
  if (state !== req.session.oauthState) {
    return res.redirect(`${FRONTEND_URL}/login?error=invalid_state`);
  }
  delete req.session.oauthState;

  try {
    // 1. Đổi code lấy access token
    const tokenRes = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: FACEBOOK_CALLBACK_URL,
        code,
      },
    });
    const { access_token } = tokenRes.data;

    // 2. Lấy thông tin user
    const userRes = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: {
        fields: 'id,name,email,picture.type(large)',
        access_token,
      },
    });

    // 3. Lưu vào session (token không expose ra frontend)
    req.session.user = {
      id: userRes.data.id,
      name: userRes.data.name,
      email: userRes.data.email || null,
      picture: userRes.data.picture?.data?.url || null,
      accessToken: access_token,
    };

    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error('[AUTH ERROR]', err.response?.data || err.message);
    res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
  }
});

// =============================================
// GET /auth/config
// Trả về config public cho frontend (App ID)
// =============================================
router.get('/config', (_req, res) => {
  res.json({ appId: FACEBOOK_APP_ID });
});

// =============================================
// POST /auth/facebook/token
// Nhận accessToken từ Facebook JS SDK (frontend)
// Verify với Facebook rồi tạo session
// =============================================
router.post('/facebook/token', async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: 'Missing accessToken' });
  }

  try {
    // 1. Verify token hợp lệ với Facebook
    const debugRes = await axios.get('https://graph.facebook.com/v21.0/debug_token', {
      params: {
        input_token: accessToken,
        access_token: `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`,
      },
    });

    const { is_valid, app_id } = debugRes.data.data;
    if (!is_valid || app_id !== FACEBOOK_APP_ID) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // 2. Lấy thông tin user
    const userRes = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: {
        fields: 'id,name,email,picture.type(large)',
        access_token: accessToken,
      },
    });

    // 3. Lưu vào session
    req.session.user = {
      id: userRes.data.id,
      name: userRes.data.name,
      email: userRes.data.email || null,
      picture: userRes.data.picture?.data?.url || null,
      accessToken,
    };

    const { accessToken: _, ...safeUser } = req.session.user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error('[TOKEN AUTH ERROR]', err.response?.data || err.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// =============================================
// GET /auth/me
// Trả thông tin user hiện tại (không trả token)
// =============================================
router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { accessToken, ...safeUser } = req.session.user;
  res.json({ user: safeUser });
});

// =============================================
// POST /auth/logout
// =============================================
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
