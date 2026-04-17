/**
 * Worker Entry Point — chạy bởi service "worker" trong docker-compose
 * Khởi động: crawlWorker + embeddingWorker
 * Command: node workers/index.js
 */
require('dotenv').config();

const { startCrawlWorker } = require('./crawlWorker');
const { startEmbeddingWorker } = require('./embeddingWorker');

console.log('====================================');
console.log(' FB Page Manager — Worker Service');
console.log('====================================');
console.log(`NODE_ENV    : ${process.env.NODE_ENV}`);
console.log(`REDIS_URL   : ${process.env.REDIS_URL}`);
console.log(`AI_SERVICE  : ${process.env.AI_SERVICE_URL}`);
console.log(`DB          : ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);
console.log('====================================');

// Khởi động cả hai workers
const crawlWorker = startCrawlWorker();
const embeddingWorker = startEmbeddingWorker();

// =============================================
// Graceful shutdown — dọn dẹp khi nhận signal
// =============================================
const shutdown = async (signal) => {
  console.log(`\n[WORKERS] Nhận ${signal}, đang shutdown...`);
  try {
    await Promise.all([
      crawlWorker.close(),
      embeddingWorker.close(),
    ]);
    console.log('[WORKERS] Shutdown hoàn tất');
    process.exit(0);
  } catch (err) {
    console.error('[WORKERS] Lỗi khi shutdown:', err.message);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Bắt lỗi không xử lý để tránh crash im lặng
process.on('unhandledRejection', (reason) => {
  console.error('[WORKERS] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[WORKERS] Uncaught Exception:', err.message);
  process.exit(1);
});
