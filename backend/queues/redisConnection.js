/**
 * Redis Connection — dùng chung cho BullMQ queues và workers
 * BullMQ yêu cầu connection object riêng (không dùng chung với session)
 * Lazy init — chỉ kết nối khi cần
 */
const { Redis } = require('ioredis');

let _connection = null;

/**
 * Trả về Redis connection object cho BullMQ.
 * BullMQ tự clone connection nội bộ, không cần quản lý lifecycle.
 */
const getRedisConnection = () => {
  if (!_connection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    _connection = new Redis(redisUrl, {
      // BullMQ yêu cầu maxRetriesPerRequest = null
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Reconnect tự động khi mất kết nối
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });

    _connection.on('error', (err) => {
      console.error('[REDIS] Connection error:', err.message);
    });

    _connection.on('connect', () => {
      console.log('[REDIS] BullMQ connection ready');
    });
  }

  return _connection;
};

module.exports = { getRedisConnection };
