/**
 * Chat DB Layer — CRUD cho AI Chat feature
 * Các bảng: ai_page_settings, chat_sessions, chat_messages, session_tags, chat_orders
 */
const { pool } = require('./migrate');

// =============================================
// AI PAGE SETTINGS
// =============================================

const getAiPageSettings = async (userId, pageId) => {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", page_id AS "pageId",
            ai_enabled AS "aiEnabled", active_hours AS "activeHours",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM ai_page_settings
     WHERE user_id = $1 AND page_id = $2`,
    [userId, pageId]
  );
  return rows[0] || null;
};

const getAiPageSettingsByPageId = async (pageId) => {
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", page_id AS "pageId",
            ai_enabled AS "aiEnabled", active_hours AS "activeHours",
            reply_style AS "replyStyle"
     FROM ai_page_settings
     WHERE page_id = $1`,
    [pageId]
  );
  return rows[0] || null;
};

const getAllAiPageSettings = async (userId) => {
  const { rows } = await pool.query(
    `SELECT id, page_id AS "pageId", ai_enabled AS "aiEnabled",
            active_hours AS "activeHours", reply_style AS "replyStyle",
            updated_at AS "updatedAt"
     FROM ai_page_settings
     WHERE user_id = $1
     ORDER BY page_id`,
    [userId]
  );
  return rows;
};

const upsertAiPageSettings = async (userId, pageId, { aiEnabled, activeHours, replyStyle }) => {
  const { rows } = await pool.query(
    `INSERT INTO ai_page_settings (user_id, page_id, ai_enabled, active_hours, reply_style, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, page_id) DO UPDATE SET
       ai_enabled   = EXCLUDED.ai_enabled,
       active_hours = EXCLUDED.active_hours,
       reply_style  = EXCLUDED.reply_style,
       updated_at   = NOW()
     RETURNING id, ai_enabled AS "aiEnabled", active_hours AS "activeHours", reply_style AS "replyStyle"`,
    [userId, pageId, aiEnabled ?? false, activeHours ?? null, replyStyle ?? null]
  );
  return rows[0];
};


// =============================================
// CHAT SESSIONS
// =============================================

const _SESSION_COLS = `
  id, page_id AS "pageId", user_id AS "userId",
  customer_psid AS "customerPsid", customer_name AS "customerName",
  customer_avatar AS "customerAvatar", intent, ai_mode AS "aiMode",
  cooldown_until AS "cooldownUntil", ai_turn_count AS "aiTurnCount",
  last_message_at AS "lastMessageAt", created_at AS "createdAt",
  identified_product AS "identifiedProduct",
  customer_mood AS "customerMood",
  product_confirmed AS "productConfirmed",
  no_product_turns AS "noProductTurns",
  unconfirmed_turns AS "unconfirmedTurns",
  closing_turns AS "closingTurns",
  profile_confirm_asked AS "profileConfirmAsked"`;

const getOrCreateSession = async ({ pageId, userId, customerPsid, customerName, customerAvatar }) => {
  const { rows: existing } = await pool.query(
    `SELECT ${_SESSION_COLS} FROM chat_sessions
     WHERE page_id = $1 AND customer_psid = $2`,
    [pageId, customerPsid]
  );

  if (existing[0]) {
    // Cập nhật tên/avatar nếu mới hơn
    if (customerName && customerName !== existing[0].customerName) {
      await pool.query(
        `UPDATE chat_sessions SET customer_name = $1, customer_avatar = $2
         WHERE id = $3`,
        [customerName, customerAvatar || existing[0].customerAvatar, existing[0].id]
      );
      existing[0].customerName = customerName;
    }
    return existing[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO chat_sessions
       (page_id, user_id, customer_psid, customer_name, customer_avatar)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${_SESSION_COLS}`,
    [pageId, userId, customerPsid, customerName || null, customerAvatar || null]
  );
  return rows[0];
};

const getSessionById = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT ${_SESSION_COLS} FROM chat_sessions WHERE id = $1`,
    [sessionId]
  );
  return rows[0] || null;
};

const getSessionsByUser = async (userId, { intentFilter, aiModeFilter } = {}) => {
  let query = `
    SELECT s.id, s.page_id AS "pageId", s.user_id AS "userId",
           s.customer_psid AS "customerPsid", s.customer_name AS "customerName",
           s.customer_avatar AS "customerAvatar", s.intent, s.ai_mode AS "aiMode",
           s.cooldown_until AS "cooldownUntil", s.ai_turn_count AS "aiTurnCount",
           s.last_message_at AS "lastMessageAt",
           s.identified_product AS "identifiedProduct",
           s.customer_mood AS "customerMood",
           s.product_confirmed AS "productConfirmed",
           s.no_product_turns AS "noProductTurns",
           s.unconfirmed_turns AS "unconfirmedTurns",
           s.closing_turns AS "closingTurns",
           (SELECT content FROM chat_messages
            WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS "lastMessageContent",
           (SELECT COUNT(*) FROM session_tags WHERE session_id = s.id) AS "tagCount"
    FROM chat_sessions s
    WHERE s.user_id = $1`;

  const params = [userId];

  if (intentFilter) {
    params.push(intentFilter);
    query += ` AND s.intent = $${params.length}`;
  }
  if (aiModeFilter) {
    params.push(aiModeFilter);
    query += ` AND s.ai_mode = $${params.length}`;
  }

  // Sort: Dừng lên đầu, rồi Muốn Mua/Đang Tư Vấn, rồi còn lại
  query += `
    ORDER BY
      CASE s.intent
        WHEN 'Dừng'         THEN 1
        WHEN 'Đang Chốt'    THEN 2
        WHEN 'Muốn Mua'     THEN 3
        WHEN 'Đang Tư Vấn'  THEN 4
        WHEN 'Đã Chốt'      THEN 5
        WHEN 'Khách Đùa'    THEN 6
        WHEN 'Không Nhu Cầu' THEN 7
        ELSE 8
      END,
      s.last_message_at DESC`;

  const { rows } = await pool.query(query, params);
  return rows;
};

const updateSessionIntent = async (sessionId, intent) => {
  await pool.query(
    `UPDATE chat_sessions
     SET intent = $1, intent_updated_at = NOW()
     WHERE id = $2`,
    [intent, sessionId]
  );
};

const updateSessionAiMode = async (sessionId, aiMode) => {
  await pool.query(
    `UPDATE chat_sessions SET ai_mode = $1 WHERE id = $2`,
    [aiMode, sessionId]
  );
};

const setCooldown = async (sessionId, hours = 5) => {
  await pool.query(
    `UPDATE chat_sessions
     SET cooldown_until = NOW() + INTERVAL '${hours} hours',
         intent = 'Không Nhu Cầu', intent_updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
};

const incrementTurnCount = async (sessionId) => {
  await pool.query(
    `UPDATE chat_sessions
     SET ai_turn_count = ai_turn_count + 1, last_message_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
};

const touchSession = async (sessionId) => {
  await pool.query(
    `UPDATE chat_sessions SET last_message_at = NOW() WHERE id = $1`,
    [sessionId]
  );
};

const updateSessionIntelligence = async (sessionId, updates = {}) => {
  const sets = [];
  const params = [sessionId];
  let i = 2;

  if ('identifiedProduct' in updates) {
    if (updates.identifiedProduct === null) {
      sets.push(`identified_product = NULL`);
    } else {
      sets.push(`identified_product = $${i}::jsonb`);
      params.push(JSON.stringify(updates.identifiedProduct));
      i++;
    }
  }
  if ('customerMood' in updates && updates.customerMood != null) {
    sets.push(`customer_mood = $${i}`);
    params.push(updates.customerMood);
    i++;
  }
  if ('productConfirmed' in updates && updates.productConfirmed != null) {
    sets.push(`product_confirmed = $${i}`);
    params.push(updates.productConfirmed);
    i++;
  }
  if ('noProductTurns' in updates && updates.noProductTurns != null) {
    sets.push(`no_product_turns = $${i}`);
    params.push(updates.noProductTurns);
    i++;
  }
  if ('unconfirmedTurns' in updates && updates.unconfirmedTurns != null) {
    sets.push(`unconfirmed_turns = $${i}`);
    params.push(updates.unconfirmedTurns);
    i++;
  }
  if ('closingTurns' in updates && updates.closingTurns != null) {
    sets.push(`closing_turns = $${i}`);
    params.push(updates.closingTurns);
    i++;
  }
  if ('profileConfirmAsked' in updates) {
    sets.push(`profile_confirm_asked = $${i}`);
    params.push(updates.profileConfirmAsked ?? false);
    i++;
  }

  if (!sets.length) return;
  await pool.query(
    `UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
};

const incrementCounter = async (sessionId, counter) => {
  const col = {
    no_product_turns:  'no_product_turns',
    unconfirmed_turns: 'unconfirmed_turns',
    closing_turns:     'closing_turns',
  }[counter];
  if (!col) throw new Error(`Unknown counter: ${counter}`);
  await pool.query(
    `UPDATE chat_sessions SET ${col} = ${col} + 1 WHERE id = $1`,
    [sessionId]
  );
};

// Lấy sessions của 1 page có ai_mode = 'AI' và có tin nhắn chưa được AI trả lời
// Dùng khi user bật lại AI cho 1 page
const getUnrepliedSessions = async (pageId) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.customer_psid AS "customerPsid", s.intent, s.ai_mode AS "aiMode",
            s.cooldown_until AS "cooldownUntil", s.ai_turn_count AS "aiTurnCount"
     FROM chat_sessions s
     WHERE s.page_id = $1
       AND s.ai_mode = 'AI'
       AND EXISTS (
         SELECT 1 FROM chat_messages m
         WHERE m.session_id = s.id
           AND m.sender_type = 'customer'
           AND m.created_at > COALESCE(
             (SELECT MAX(created_at) FROM chat_messages
              WHERE session_id = s.id AND sender_type IN ('ai', 'human')),
             '1970-01-01'
           )
       )`,
    [pageId]
  );
  return rows;
};


// =============================================
// CHAT MESSAGES
// =============================================

const saveMessage = async ({
  sessionId, senderType, content, attachments = [],
  fbMessageId = null, intentAtTime = null,
  isConfirmationSummary = false, isCustomerConfirmed = false,
}) => {
  const { rows } = await pool.query(
    `INSERT INTO chat_messages
       (session_id, sender_type, content, attachments, fb_message_id,
        intent_at_time, is_confirmation_summary, is_customer_confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (fb_message_id) DO NOTHING
     RETURNING id, session_id AS "sessionId", sender_type AS "senderType",
               content, attachments, fb_message_id AS "fbMessageId",
               is_confirmation_summary AS "isConfirmationSummary",
               is_customer_confirmed AS "isCustomerConfirmed",
               created_at AS "createdAt"`,
    [
      sessionId, senderType, content || null,
      JSON.stringify(attachments), fbMessageId,
      intentAtTime, isConfirmationSummary, isCustomerConfirmed,
    ]
  );

  // Cập nhật last_message_at của session
  if (rows[0]) {
    await touchSession(sessionId);
  }

  return rows[0] || null;
};

const getMessageById = async (messageId) => {
  const { rows } = await pool.query(
    `SELECT id, sender_type AS "senderType", content, attachments,
            intent_at_time AS "intentAtTime",
            is_confirmation_summary AS "isConfirmationSummary",
            is_customer_confirmed AS "isCustomerConfirmed",
            fb_message_id AS "fbMessageId",
            created_at AS "createdAt"
     FROM chat_messages WHERE id = $1`,
    [messageId]
  );
  return rows[0] || null;
};

const getSessionMessages = async (sessionId, limit = 20) => {
  const { rows } = await pool.query(
    `SELECT id, sender_type AS "senderType", content, attachments,
            intent_at_time AS "intentAtTime",
            is_confirmation_summary AS "isConfirmationSummary",
            is_customer_confirmed AS "isCustomerConfirmed",
            fb_message_id AS "fbMessageId",
            created_at AS "createdAt"
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [sessionId, limit]
  );
  return rows;
};

const getConfirmationMessages = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT id, sender_type AS "senderType", content, attachments,
            is_confirmation_summary AS "isConfirmationSummary",
            is_customer_confirmed AS "isCustomerConfirmed",
            created_at AS "createdAt"
     FROM chat_messages
     WHERE session_id = $1
       AND (is_confirmation_summary = true OR is_customer_confirmed = true)
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows;
};


// =============================================
// SESSION TAGS
// =============================================

const addSessionTag = async (sessionId, tag) => {
  await pool.query(
    `INSERT INTO session_tags (session_id, tag)
     VALUES ($1, $2)
     ON CONFLICT (session_id, tag) DO NOTHING`,
    [sessionId, tag.trim()]
  );
};

const removeSessionTag = async (sessionId, tag) => {
  await pool.query(
    `DELETE FROM session_tags WHERE session_id = $1 AND tag = $2`,
    [sessionId, tag]
  );
};

const getSessionTags = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT tag, created_at AS "createdAt"
     FROM session_tags WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows.map((r) => r.tag);
};


// =============================================
// CHAT ORDERS
// =============================================

const createOrder = async ({
  sessionId, customerName, phone, address, productName, note,
  confirmationSummaryMsgId = null, customerConfirmedMsgId = null,
  customerConfirmedAt = null,
}) => {
  const { rows } = await pool.query(
    `INSERT INTO chat_orders
       (session_id, customer_name, phone, address, product_name, note,
        confirmation_summary_msg_id, customer_confirmed_msg_id, customer_confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, status, created_at AS "createdAt"`,
    [
      sessionId, customerName, phone, address, productName, note,
      confirmationSummaryMsgId, customerConfirmedMsgId, customerConfirmedAt,
    ]
  );
  return rows[0];
};

const getOrderBySession = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT id, session_id AS "sessionId", customer_name AS "customerName",
            phone, address, product_name AS "productName", note, status,
            confirmation_summary_msg_id AS "confirmationSummaryMsgId",
            customer_confirmed_msg_id AS "customerConfirmedMsgId",
            customer_confirmed_at AS "customerConfirmedAt",
            created_at AS "createdAt"
     FROM chat_orders WHERE session_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
};

const getPendingOrders = async (userId) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.session_id AS "sessionId", o.customer_name AS "customerName",
            o.phone, o.address, o.product_name AS "productName", o.note, o.status,
            o.customer_confirmed_at AS "customerConfirmedAt", o.created_at AS "createdAt",
            s.customer_psid AS "customerPsid", s.page_id AS "pageId"
     FROM chat_orders o
     JOIN chat_sessions s ON s.id = o.session_id
     WHERE s.user_id = $1 AND o.status = 'PENDING_REVIEW'
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return rows;
};

const updateOrderStatus = async (orderId, status) => {
  const { rows } = await pool.query(
    `UPDATE chat_orders SET status = $1
     WHERE id = $2
     RETURNING id, status`,
    [status, orderId]
  );
  return rows[0] || null;
};

// =============================================
// CUSTOMER PROFILES
// =============================================

const getCustomerProfile = async (customerPsid, pageId) => {
  const { rows } = await pool.query(
    `SELECT id, customer_psid AS "customerPsid", page_id AS "pageId",
            name, phone, address, note,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM customer_profiles
     WHERE customer_psid = $1 AND page_id = $2`,
    [customerPsid, pageId]
  );
  return rows[0] || null;
};

const upsertCustomerProfile = async ({ customerPsid, pageId, name, phone, address, note }) => {
  const { rows } = await pool.query(
    `INSERT INTO customer_profiles (customer_psid, page_id, name, phone, address, note, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (customer_psid, page_id) DO UPDATE SET
       name       = COALESCE($3, customer_profiles.name),
       phone      = COALESCE($4, customer_profiles.phone),
       address    = COALESCE($5, customer_profiles.address),
       note       = COALESCE($6, customer_profiles.note),
       updated_at = NOW()
     RETURNING id, name, phone, address, note`,
    [customerPsid, pageId, name || null, phone || null, address || null, note || null]
  );
  return rows[0];
};


// Đánh dấu tin nhắn khách là xác nhận đơn hàng, cập nhật chat_orders
const markCustomerConfirmed = async (sessionId, messageId) => {
  await pool.query(
    `UPDATE chat_messages SET is_customer_confirmed = true WHERE id = $1`,
    [messageId]
  );
  await pool.query(
    `UPDATE chat_orders
     SET customer_confirmed_msg_id = $1,
         customer_confirmed_at = NOW(),
         status = 'PENDING_REVIEW'
     WHERE session_id = $2 AND status = 'PENDING_REVIEW'`,
    [messageId, sessionId]
  );
};


module.exports = {
  // Settings
  getAiPageSettings,
  getAiPageSettingsByPageId,
  getAllAiPageSettings,
  upsertAiPageSettings,
  // Sessions
  getOrCreateSession,
  getSessionById,
  getSessionsByUser,
  updateSessionIntent,
  updateSessionAiMode,
  setCooldown,
  incrementTurnCount,
  touchSession,
  updateSessionIntelligence,
  incrementCounter,
  getUnrepliedSessions,
  // Messages
  saveMessage,
  getMessageById,
  getSessionMessages,
  getConfirmationMessages,
  // Tags
  addSessionTag,
  removeSessionTag,
  getSessionTags,
  // Orders
  createOrder,
  getOrderBySession,
  getPendingOrders,
  updateOrderStatus,
  markCustomerConfirmed,
  // Customer Profiles
  getCustomerProfile,
  upsertCustomerProfile,
};
