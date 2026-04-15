/**
 * NeDB — embedded database, pure JavaScript, không cần compile
 * Dữ liệu lưu tại: backend/db/posts.db (file text)
 */
const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, 'posts.db'),
  autoload: true, // Tự tải file khi khởi động
});

// Index để query nhanh hơn
db.ensureIndex({ fieldName: 'id', unique: true });
db.ensureIndex({ fieldName: 'pageId' });
db.ensureIndex({ fieldName: 'userId' });

// =============================================
// Lưu nhiều posts (upsert — nếu đã có thì update)
// =============================================
const savePosts = (userId, pageId, posts) => {
  return new Promise((resolve, reject) => {
    let saved = 0;
    if (posts.length === 0) return resolve(0);

    posts.forEach((post, idx) => {
      const doc = {
        id: post.id,
        pageId,
        userId,
        message: post.message || '',
        createdTime: post.createdTime || null,
        pictureUrl: post.picture || null,
        permalink: post.permalink || null,
        likes: post.likes || 0,
        comments: post.comments || 0,
        shares: post.shares || 0,
        savedAt: new Date().toISOString(),
      };

      db.update(
        { id: post.id },
        { $set: doc },
        { upsert: true },
        (err) => {
          if (!err) saved++;
          if (idx === posts.length - 1) {
            // Tất cả đã xử lý xong
            setTimeout(() => resolve(saved), 50);
          }
        }
      );
    });
  });
};

// =============================================
// Lấy posts của 1 page từ DB
// =============================================
const getPostsByPage = (userId, pageId, limit = 50) => {
  return new Promise((resolve, reject) => {
    db.find({ userId, pageId })
      .sort({ createdTime: -1 })
      .limit(limit)
      .exec((err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
  });
};

// =============================================
// Đếm số posts trong DB
// =============================================
const countPosts = (userId, pageId) => {
  return new Promise((resolve, reject) => {
    db.count({ userId, pageId }, (err, count) => {
      if (err) return reject(err);
      resolve(count);
    });
  });
};

// =============================================
// Tổng quan pages đã lưu của 1 user
// =============================================
const getSavedPages = (userId) => {
  return new Promise((resolve, reject) => {
    db.find({ userId }, (err, docs) => {
      if (err) return reject(err);

      // Group by pageId
      const map = {};
      docs.forEach((doc) => {
        if (!map[doc.pageId]) {
          map[doc.pageId] = { pageId: doc.pageId, postCount: 0, lastSaved: null };
        }
        map[doc.pageId].postCount++;
        if (!map[doc.pageId].lastSaved || doc.savedAt > map[doc.pageId].lastSaved) {
          map[doc.pageId].lastSaved = doc.savedAt;
        }
      });

      resolve(Object.values(map));
    });
  });
};

module.exports = { savePosts, getPostsByPage, countPosts, getSavedPages };
