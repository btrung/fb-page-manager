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

const addChatJob = async ({ sessionId, pageId, userId }) => {
  const queue = getChatQueue();
  // Delay 7s để gom nhiều tin nhắn liên tiếp vào 1 lần xử lý.
  // Không dùng jobId dedup vì completed jobs giữ ID 30 phút → drop tin mới.
  // getUnrepliedCustomerMessages trong worker tự dedup: nếu không có tin mới → skip.
  const job = await queue.add(
    'process-message',
    { sessionId, pageId, userId },
    { delay: 7000 },
  );
  return { jobId: job.id };
};

module.exports = { getChatQueue, addChatJob };
