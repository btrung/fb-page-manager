require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const intelligenceRoutes = require('./routes/intelligence');
const { webhookRouter, debugRouter } = require('./routes/sync');
const { requireAuth } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// =============================================
// Redis — dùng làm session store khi có REDIS_URL
// Fallback về in-memory nếu chạy local không có Redis
// =============================================
let sessionStore;
if (process.env.REDIS_URL) {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.connect().catch((err) => console.error('[REDIS]', err.message));
  sessionStore = new RedisStore({ client: redisClient });
}

// =============================================
// Trust proxy (bắt buộc trên Render/Railway)
// =============================================
app.set('trust proxy', 1);

// =============================================
// Middleware
// =============================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(express.json());

// CORS — dev: cho phép Vite, prod: cùng origin nên không cần
if (!isProd) {
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://localhost:5173',
    credentials: true,
  }));
}

// =============================================
// Session
// =============================================
app.use(session({
  store: sessionStore,  // Redis nếu có, in-memory nếu không
  secret: process.env.SESSION_SECRET || 'change_this_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    sameSite: isProd ? 'lax' : 'lax',
  },
}));

// =============================================
// API Routes
// =============================================
app.use('/auth', authRoutes);
app.use('/api', requireAuth, apiRoutes);
app.use('/api/intelligence', requireAuth, intelligenceRoutes);
app.use('/api/debug', requireAuth, debugRouter);
// Webhook không cần auth — FB gọi trực tiếp
app.use('/sync', webhookRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV });
});

// =============================================
// Serve React build trong production
// =============================================
if (isProd) {
  const distPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(distPath));

  // Mọi route không phải API đều trả về index.html (React Router)
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// =============================================
// Error handler
// =============================================
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// Khởi động workers trong cùng process khi START_WORKERS=true
// Dùng cho Render free tier (không có background worker service)
if (process.env.START_WORKERS === 'true') {
  const { startCrawlWorker } = require('./workers/crawlWorker');
  const { startEmbeddingWorker } = require('./workers/embeddingWorker');
  startCrawlWorker();
  startEmbeddingWorker();
  console.log('[SERVER] Workers started in-process');
}
