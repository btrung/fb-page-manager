/**
 * Facebook Send API helpers
 * Dùng chung cho chatWorker (tự động) và chatRoutes (human reply)
 */
const { pool } = require('../db/migrate');

const FB_API_VERSION = 'v19.0';

const _getPageToken = async (pageId) => {
  const { rows } = await pool.query(
    'SELECT page_access_token FROM page_tokens WHERE page_id = $1',
    [pageId]
  );
  if (!rows[0]) throw new Error(`No page token for page ${pageId}`);
  return rows[0].page_access_token;
};

const _fbPost = async (token, body) => {
  const resp = await fetch(
    `https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`FB Send API error: ${JSON.stringify(err)}`);
  }
  return resp.json();
};

/**
 * Gửi tin nhắn văn bản
 */
const sendFbMessage = async (pageId, recipientPsid, text) => {
  const token = await _getPageToken(pageId);
  return _fbPost(token, {
    recipient: { id: recipientPsid },
    message:   { text },
  });
};

/**
 * Gửi ảnh đính kèm (URL công khai)
 */
const sendFbImage = async (pageId, recipientPsid, imageUrl) => {
  const token = await _getPageToken(pageId);
  return _fbPost(token, {
    recipient: { id: recipientPsid },
    message: {
      attachment: {
        type: 'image',
        payload: { url: imageUrl, is_reusable: true },
      },
    },
  });
};

/**
 * Gửi ảnh + text liên tiếp (ảnh trước, text sau)
 * FB không hỗ trợ gửi cả 2 trong 1 request nên gửi tuần tự
 */
const sendFbImageWithCaption = async (pageId, recipientPsid, imageUrl, text) => {
  await sendFbImage(pageId, recipientPsid, imageUrl);
  return sendFbMessage(pageId, recipientPsid, text);
};

/**
 * Gửi button mở webview bên trong Messenger
 * Dùng cho form điền thông tin giao hàng / chọn biến thể
 */
const sendWebviewButton = async (pageId, recipientPsid, text, buttonTitle, webviewUrl) => {
  const token = await _getPageToken(pageId);
  return _fbPost(token, {
    recipient: { id: recipientPsid },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: [{
            type:                 'web_url',
            url:                  webviewUrl,
            title:                buttonTitle,
            messenger_extensions: true,
            webview_height_ratio: 'tall',
          }],
        },
      },
    },
  });
};

/**
 * Gửi quick replies (các lựa chọn nhấn nhanh)
 * Dùng cho chọn size, màu sắc...
 */
const sendQuickReplies = async (pageId, recipientPsid, text, options) => {
  const token = await _getPageToken(pageId);
  return _fbPost(token, {
    recipient: { id: recipientPsid },
    message: {
      text,
      quick_replies: options.slice(0, 13).map((opt) => ({
        content_type: 'text',
        title:        String(opt).slice(0, 20),
        payload:      String(opt).toUpperCase().replace(/\s+/g, '_').slice(0, 1000),
      })),
    },
  });
};

module.exports = { sendFbMessage, sendFbImage, sendFbImageWithCaption, sendWebviewButton, sendQuickReplies };
