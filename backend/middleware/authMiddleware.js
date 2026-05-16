/**
 * Middleware kiểm tra user đã đăng nhập chưa
 * Dùng cho các route cần bảo vệ
 */
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  req.user = req.session.user;
  next();
};

module.exports = { requireAuth };
