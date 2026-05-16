/**
 * Form Routes — Webview form bên trong Messenger
 *
 * GET  /form/shipping?session=xxx&page=xxx   — serve HTML form
 * GET  /form/profile?session=xxx             — lấy thông tin cũ (pre-fill)
 * POST /form/shipping                        — nhận form submission
 */
const express  = require('express');
const chatDB   = require('../db/chatDB');
const { pool } = require('../db/migrate');
const { sendFbMessage } = require('../utils/fbSendApi');
const axios    = require('axios');

const router   = express.Router();
const PHONE_RE = /^(0|\+84)[0-9]{8,10}$/;
const AI_URL   = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ── GET /form/shipping — serve HTML form ──────────────────────────────────────

router.get('/shipping', (req, res) => {
  const { session: sessionId, page: pageId } = req.query;
  const appUrl = process.env.APP_URL || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Thông tin giao hàng</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5; min-height: 100vh; padding: 16px;
    }
    .card {
      background: white; border-radius: 12px; padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08); max-width: 480px; margin: 0 auto;
    }
    h2 { font-size: 18px; color: #1a1a1a; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 20px; }

    .product-box {
      background: #f0f4ff; border-radius: 8px; padding: 12px;
      margin-bottom: 20px; font-size: 14px; color: #333;
    }
    .product-box .product-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .product-box .product-price {
      display: inline-block; background: #e8f0fe; color: #1877f2;
      border-radius: 4px; padding: 2px 8px; font-size: 13px; font-weight: 600;
      margin-top: 4px;
    }
    .price-lock { font-size: 11px; color: #999; margin-left: 4px; }

    .section-title {
      font-size: 12px; font-weight: 600; color: #888; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 12px; margin-top: 4px;
    }
    .divider { border: none; border-top: 1px solid #f0f0f0; margin: 16px 0; }

    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 500; }
    input, textarea, select {
      width: 100%; padding: 12px; border: 1.5px solid #e0e0e0;
      border-radius: 8px; font-size: 15px; outline: none; transition: border-color .2s;
      background: #fafafa; appearance: none; -webkit-appearance: none;
    }
    input:focus, textarea:focus, select:focus { border-color: #1877f2; background: white; }
    textarea { resize: none; height: 80px; }
    .select-wrap { position: relative; }
    .select-wrap::after {
      content: '▾'; position: absolute; right: 12px; top: 50%;
      transform: translateY(-50%); color: #888; pointer-events: none; font-size: 14px;
    }
    .error { color: #e03e3e; font-size: 12px; margin-top: 4px; display: none; }
    .btn {
      width: 100%; padding: 14px; background: #1877f2; color: white;
      border: none; border-radius: 8px; font-size: 16px; font-weight: 600;
      cursor: pointer; margin-top: 8px; transition: background .2s;
    }
    .btn:hover { background: #166fe5; }
    .btn:disabled { background: #a0b9e8; cursor: not-allowed; }
    .success { display: none; text-align: center; padding: 32px 16px; }
    .success-icon { font-size: 48px; margin-bottom: 12px; }
    .success h3 { color: #1a1a1a; font-size: 18px; margin-bottom: 8px; }
    .success p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div id="form-view">
      <h2>📦 Thông tin giao hàng</h2>
      <p class="subtitle">Điền đầy đủ để em chốt đơn ngay nhé!</p>

      <div class="product-box" id="product-info">Đang tải...</div>

      <div id="variants-section"></div>

      <hr class="divider">
      <p class="section-title">Thông tin nhận hàng</p>

      <form id="shipping-form">
        <div class="form-group">
          <label>Họ tên người nhận *</label>
          <input type="text" id="name" placeholder="Ví dụ: Nguyễn Văn A" autocomplete="name">
          <div class="error" id="name-error">Vui lòng nhập họ tên (ít nhất 2 ký tự)</div>
        </div>
        <div class="form-group">
          <label>Số điện thoại *</label>
          <input type="tel" id="phone" placeholder="Ví dụ: 0912345678" autocomplete="tel" inputmode="numeric">
          <div class="error" id="phone-error">Số điện thoại không đúng định dạng</div>
        </div>
        <div class="form-group">
          <label>Địa chỉ giao hàng *</label>
          <textarea id="address" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" autocomplete="street-address"></textarea>
          <div class="error" id="address-error">Vui lòng nhập địa chỉ đầy đủ</div>
        </div>
        <button type="submit" class="btn" id="submit-btn">✅ Xác nhận đặt hàng</button>
      </form>
    </div>

    <div class="success" id="success-view">
      <div class="success-icon">🎉</div>
      <h3>Đặt hàng thành công!</h3>
      <p>Em sẽ xác nhận lại đơn trong Messenger cho anh/chị nhé!</p>
    </div>
  </div>

  <script src="//connect.facebook.net/en_US/messenger.Extensions.js"
    onerror="console.log('Not in Messenger context')">
  </script>
  <script>
    const SESSION_ID = '${sessionId}';
    const PAGE_ID    = '${pageId}';
    const API_BASE   = '${appUrl}';

    // variants đang chọn (có thể sửa trên form)
    let currentVariants = {};

    // Render variant fields động
    function renderVariants(requiredVariants, currentVars) {
      const section = document.getElementById('variants-section');
      if (!requiredVariants || requiredVariants.length === 0) {
        section.innerHTML = '';
        return;
      }

      let html = '<p class="section-title">Thông tin sản phẩm</p>';
      requiredVariants.forEach(varName => {
        const val = currentVars[varName] || '';
        const id  = 'var_' + varName.replace(/\\s+/g, '_');
        html += \`
          <div class="form-group">
            <label>\${capitalize(varName)} *</label>
            <input type="text" id="\${id}" data-variant="\${varName}"
              value="\${escHtml(val)}" placeholder="Nhập \${varName}...">
            <div class="error" id="\${id}-error">Vui lòng chọn \${varName}</div>
          </div>\`;
      });
      html += '<hr class="divider">';
      section.innerHTML = html;
    }

    function capitalize(str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }
    function escHtml(str) {
      return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    }

    // Đọc variant values từ form
    function getVariantValues() {
      const vals = {};
      document.querySelectorAll('[data-variant]').forEach(el => {
        vals[el.dataset.variant] = el.value.trim();
      });
      return vals;
    }

    // Load thông tin cũ + sản phẩm
    async function loadProfile() {
      try {
        const res  = await fetch(API_BASE + '/form/profile?session=' + SESSION_ID);
        const data = await res.json();

        // Hiển thị sản phẩm + giá (locked)
        let infoHtml = '';
        if (data.product) {
          infoHtml += '<div class="product-name">📦 ' + escHtml(data.product) + '</div>';
        }
        if (data.price) {
          infoHtml += '<div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span style="font-size:13px;color:#555;">Giá đơn hàng</span>'
                    + '<span style="font-size:20px;font-weight:700;color:#1877f2;">' + escHtml(data.price) + '</span>'
                    + '</div>'
                    + '<div style="font-size:11px;color:#aaa;text-align:right;margin-top:2px;">🔒 Giá cố định, không thay đổi</div>';
        }
        document.getElementById('product-info').innerHTML = infoHtml || 'Xác nhận đơn hàng';

        // Render variant fields
        currentVariants = data.current_variants || {};
        renderVariants(data.required_variants || [], currentVariants);

        // Pre-fill thông tin giao hàng
        if (data.name)    document.getElementById('name').value    = data.name;
        if (data.phone)   document.getElementById('phone').value   = data.phone;
        if (data.address) document.getElementById('address').value = data.address;
      } catch (e) {
        document.getElementById('product-info').textContent = 'Xác nhận đơn hàng';
      }
    }

    function validatePhone(phone) {
      return /^(0|\\+84)[0-9]{8,10}$/.test(phone.replace(/[\\s\\-]/g, ''));
    }

    document.getElementById('shipping-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const name    = document.getElementById('name').value.trim();
      const phone   = document.getElementById('phone').value.trim();
      const address = document.getElementById('address').value.trim();
      const variants = getVariantValues();
      let valid = true;

      document.querySelectorAll('.error').forEach(el => el.style.display = 'none');

      if (name.length < 2) {
        document.getElementById('name-error').style.display = 'block'; valid = false;
      }
      if (!validatePhone(phone)) {
        document.getElementById('phone-error').style.display = 'block'; valid = false;
      }
      if (address.length < 10) {
        document.getElementById('address-error').style.display = 'block'; valid = false;
      }
      // Validate variants
      document.querySelectorAll('[data-variant]').forEach(el => {
        if (!el.value.trim()) {
          document.getElementById('var_' + el.dataset.variant.replace(/\\s+/g, '_') + '-error').style.display = 'block';
          valid = false;
        }
      });

      if (!valid) return;

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Đang gửi...';

      try {
        const res = await fetch(API_BASE + '/form/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, pageId: PAGE_ID, name, phone, address, variants }),
        });

        if (!res.ok) throw new Error('Submit failed');

        document.getElementById('form-view').style.display = 'none';
        document.getElementById('success-view').style.display = 'block';

        setTimeout(() => {
          if (window.MessengerExtensions) MessengerExtensions.requestCloseBrowser(null, null);
        }, 2000);

      } catch (err) {
        btn.disabled = false;
        btn.textContent = '✅ Xác nhận đặt hàng';
        alert('Có lỗi xảy ra, anh/chị thử lại nhé!');
      }
    });

    loadProfile();
  </script>
</body>
</html>`);
});


// ── GET /form/profile — pre-fill data ────────────────────────────────────────

router.get('/profile', async (req, res) => {
  const { session: sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'session required' });

  try {
    const session = await chatDB.getSessionById(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });

    const profile  = await chatDB.getCustomerProfile(session.customerPsid, session.pageId);
    const product  = session.identifiedProduct || {};

    // Fallback: lấy giá từ DB posts nếu session chưa có
    let priceNum = product.price || null;
    if (!priceNum && product.name) {
      const { rows } = await pool.query(
        `SELECT price FROM posts WHERE page_id = $1 AND what_is_product ILIKE $2 AND price IS NOT NULL LIMIT 1`,
        [session.pageId, `%${product.name.split(' ').slice(0, 3).join('%')}%`]
      ).catch(() => ({ rows: [] }));
      if (rows[0]?.price) priceNum = rows[0].price;
    }
    const price = priceNum ? `${Number(priceNum).toLocaleString('vi-VN')}đ` : null;

    res.json({
      name:              profile?.name    || '',
      phone:             profile?.phone   || '',
      address:           profile?.address || '',
      product:           product.name     || '',
      price,
      required_variants: product.required_variants || [],
      current_variants:  session.productVariants   || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /form/shipping — form submission ─────────────────────────────────────

router.post('/shipping', express.json(), async (req, res) => {
  const { sessionId, pageId, name, phone, address, variants } = req.body;

  if (!sessionId || !name || !phone || !address) {
    return res.status(400).json({ error: 'missing fields' });
  }

  const cleanPhone = phone.replace(/[\s-]/g, '');
  if (!PHONE_RE.test(cleanPhone)) return res.status(400).json({ error: 'invalid phone' });
  if (name.trim().length < 2)    return res.status(400).json({ error: 'invalid name' });
  if (address.trim().length < 10) return res.status(400).json({ error: 'invalid address' });

  try {
    const session = await chatDB.getSessionById(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });

    const cleanName    = name.trim();
    const cleanAddress = address.trim();

    // Lưu profile giao hàng
    await chatDB.upsertCustomerProfile({
      customerPsid: session.customerPsid,
      pageId:       session.pageId,
      name:         cleanName,
      phone:        cleanPhone,
      address:      cleanAddress,
    });

    // Cập nhật variants nếu có thay đổi
    if (variants && Object.keys(variants).length > 0) {
      const merged = { ...(session.productVariants || {}), ...variants };
      await chatDB.updateSessionIntelligence(sessionId, { productVariants: merged });
    }

    // Tạo confirmation message
    const product  = session.identifiedProduct || {};
    const finalVariants = variants && Object.keys(variants).length > 0
      ? { ...(session.productVariants || {}), ...variants }
      : session.productVariants || {};

    const variantStr = Object.entries(finalVariants)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    let confirmReply;
    try {
      const aiRes = await axios.post(`${AI_URL}/chat/generate-confirmation`, {
        product_name:     product.name  || '',
        price:            product.price || null,
        variants:         variantStr    || null,
        customer_name:    cleanName,
        phone:            cleanPhone,
        address:          cleanAddress,
      }, { timeout: 10000 });
      confirmReply = aiRes.data.reply;
    } catch {
      const priceStr = product.price
        ? `${Number(product.price).toLocaleString('vi-VN')}đ`
        : 'Liên hệ';
      confirmReply = `Dạ em xác nhận lại đơn ạ:\n📦 ${product.name || 'Sản phẩm'}${variantStr ? ' (' + variantStr + ')' : ''}\n💰 ${priceStr}\n👤 ${cleanName}\n📞 ${cleanPhone}\n📍 ${cleanAddress}\nAnh/chị xác nhận đặt nhé ạ? ✅`;
    }

    await sendFbMessage(session.pageId, session.customerPsid, confirmReply);

    await chatDB.saveMessage({
      sessionId,
      senderType:            'ai',
      content:               confirmReply,
      isConfirmationSummary: true,
    });
    await chatDB.incrementTurnCount(sessionId);
    await chatDB.touchSession(sessionId);
    await chatDB.updateSessionIntent(sessionId, 'Đang Chốt');

    res.json({ ok: true });
  } catch (err) {
    console.error('[FORM] shipping submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
