const express = require('express');
const axios = require('axios');
const { savePosts, getPostsByPage, countPosts, getSavedPages } = require('../db/database');
const { pool } = require('../db/migrate');
const router = express.Router();

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// =============================================
// GET /api/pages
// Lấy danh sách Facebook Pages user quản lý
// =============================================
router.get('/pages', async (req, res, next) => {
  const { accessToken, id: userId } = req.session.user;

  try {
    const response = await axios.get(`${GRAPH_API}/me/accounts`, {
      params: {
        fields: 'id,name,picture{url},fan_count,category,access_token',
        limit: 50,
        access_token: accessToken,
      },
    });

    // Lưu page tokens vào session (không expose ra client)
    req.session.pageTokens = {};
    response.data.data.forEach((page) => {
      req.session.pageTokens[page.id] = page.access_token;
    });

    // Lưu page tokens vào DB để webhook auto-sync dùng
    for (const page of response.data.data) {
      if (page.access_token) {
        pool.query(
          `INSERT INTO page_tokens (page_id, user_id, page_access_token, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (page_id) DO UPDATE SET
             page_access_token = EXCLUDED.page_access_token,
             updated_at = NOW()`,
          [page.id, userId, page.access_token],
        ).catch((err) => console.error('[API] Lưu page token thất bại:', err.message));
      }
    }

    // Lấy số posts đã lưu trong DB cho mỗi page
    const savedPages = await getSavedPages(userId);
    const savedMap = {};
    savedPages.forEach((p) => { savedMap[p.pageId] = p.postCount; });

    const pages = response.data.data.map((page) => ({
      id: page.id,
      name: page.name,
      picture: page.picture?.data?.url || null,
      fanCount: page.fan_count || 0,
      category: page.category || '',
      savedPostCount: savedMap[page.id] || 0, // Hiển thị số posts đã có trong DB
    }));

    res.json({ pages });
  } catch (err) {
    console.error('[PAGES ERROR]', err.response?.data || err.message);
    next({ status: 502, message: 'Failed to fetch pages from Facebook' });
  }
});

// =============================================
// GET /api/pages/:pageId/posts
// Fetch 50 posts từ Facebook + tự động lưu vào SQLite
// =============================================
router.get('/pages/:pageId/posts', async (req, res, next) => {
  const { pageId } = req.params;
  const { id: userId } = req.session.user;
  const pageTokens = req.session.pageTokens || {};
  const pageAccessToken = pageTokens[pageId];

  if (!pageAccessToken) {
    return res.status(403).json({
      error: 'Không tìm thấy token cho page này. Hãy quay lại trang Dashboard để tải lại.',
    });
  }

  try {
    // 1. Fetch từ Facebook Graph API
    const response = await axios.get(`${GRAPH_API}/${pageId}/posts`, {
      params: {
        fields: [
          'id',
          'message',
          'story',
          'created_time',
          'full_picture',
          'permalink_url',
          'likes.summary(true)',
          'comments.summary(true)',
          'shares',
          'attachments{media_type,media,title,description,url}',
        ].join(','),
        limit: 50,
        access_token: pageAccessToken,
      },
    });

    const posts = response.data.data.map((post) => ({
      id: post.id,
      message: post.message || post.story || '',
      createdTime: post.created_time,
      picture: post.full_picture || null,
      permalink: post.permalink_url || null,
      likes: post.likes?.summary?.total_count || 0,
      comments: post.comments?.summary?.total_count || 0,
      shares: post.shares?.count || 0,
      attachments: post.attachments?.data || [],
    }));

    // 2. Tự động lưu vào NeDB
    const savedCount = await savePosts(userId, pageId, posts);

    // 3. Trả về posts + thông tin DB
    res.json({
      pageId,
      total: posts.length,
      posts,
      db: {
        saved: savedCount,
        message: `Đã lưu ${savedCount} bài vào database`,
      },
    });
  } catch (err) {
    console.error('[POSTS ERROR]', err.response?.data || err.message);
    next({ status: 502, message: 'Failed to fetch posts from Facebook' });
  }
});

// =============================================
// GET /api/db/pages/:pageId
// Xem posts đang có trong DB (để verify)
// =============================================
router.get('/db/pages/:pageId', async (req, res, next) => {
  const { pageId } = req.params;
  const { id: userId } = req.session.user;
  const limit = parseInt(req.query.limit) || 50;

  try {
    const [posts, total] = await Promise.all([
      getPostsByPage(userId, pageId, limit),
      countPosts(userId, pageId),
    ]);

    res.json({
      pageId,
      userId,
      totalInDb: total,
      posts: posts.map((p) => ({
        id: p.id,
        message: p.message?.slice(0, 100) + (p.message?.length > 100 ? '...' : ''),
        createdTime: p.createdTime,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        hasPicture: !!p.pictureUrl,
        savedAt: p.savedAt,
      })),
    });
  } catch (err) {
    next({ status: 500, message: 'DB error' });
  }
});

// =============================================
// GET /api/db/summary
// Tổng quan tất cả pages đã lưu của user hiện tại
// =============================================
router.get('/db/summary', async (req, res) => {
  const { id: userId } = req.session.user;
  try {
    const pages = await getSavedPages(userId);
    res.json({
      userId,
      totalPages: pages.length,
      totalPosts: pages.reduce((sum, p) => sum + p.postCount, 0),
      pages,
    });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// =============================================
// POST /api/pages/:pageId/analyze
// Gửi posts sang AI Service để tạo vector embeddings
// =============================================
router.post('/pages/:pageId/analyze', async (req, res, next) => {
  const { posts } = req.body;

  if (!posts || !Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: 'No posts provided' });
  }

  try {
    const aiResponse = await axios.post(`${AI_SERVICE_URL}/analyze/posts`, {
      page_id: req.params.pageId,
      user_id: req.session.user.id,
      posts: posts.map((p) => ({
        id: p.id,
        message: p.message,
        picture: p.picture,
        created_time: p.createdTime,
      })),
    });

    res.json(aiResponse.data);
  } catch (err) {
    console.error('[AI SERVICE ERROR]', err.response?.data || err.message);
    next({ status: 502, message: 'AI service unavailable' });
  }
});

module.exports = router;
