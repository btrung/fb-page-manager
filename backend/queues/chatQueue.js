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

const addChatJob = async ({ sessionId, pageId, userId, messageId }) => {
  const queue = getChatQueue();
  const job = await queue.add(
    'process-message',
    { sessionId, pageId, userId, messageId },
    { delay: 2000 },
  );
  return { jobId: job.id };
};

module.exports = { getChatQueue, addChatJob };
