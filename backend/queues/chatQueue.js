/**
 * Chat Queue — BullMQ
 * Xử lý tin nhắn đến từ Messenger, chạy AI pipeline
 *
 * Job payload:
 *   { sessionId, pageId, userId }
 */
const { Queue } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');

const CHAT_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 3000 },
  removeOnComplete: { age: 1800, count: 200 },
  removeOnFail:     { age: 86400, count: 100 },
};

let _chatQueue = null;

const getChatQueue = () => {
  if (!_chatQueue) {
    _chatQueue = new Queue('chat', {
      connection: getRedisConnection(),
      defaultJobOptions: CHAT_JOB_OPTIONS,
    });
  }
  return _chatQueue;
};

/**
 * Thêm job xử lý tin nhắn mới vào queue.
 * Dùng jobId cố định theo sessionId để tránh queue chồng chất
 * nếu khách nhắn nhiều tin liên tiếp (BullMQ dedup theo jobId).
 */
const addChatJob = async ({ sessionId, pageId, userId }) => {
  const queue = getChatQueue();
  // delay 500ms: gom tin nhắn liên tiếp trong cùng 1 job
  const job = await queue.add(
    'process-message',
    { sessionId, pageId, userId },
    { jobId: `chat:${sessionId}`, delay: 500 },
  );
  return { jobId: job.id };
};

module.exports = { getChatQueue, addChatJob };
