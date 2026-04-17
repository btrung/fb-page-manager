/**
 * Embedding Queue — BullMQ
 * Xử lý job tạo CLIP embedding cho ảnh từ bài đăng
 *
 * Job payload:
 *   { mediaId, postId, pageId, userId, imageUrl, productId, productName }
 *
 * Job flow:
 *   1. Gọi AI service /embed/image
 *   2. Nhận vector 512d
 *   3. Lưu vào post_media.image_embedding (PostgreSQL)
 *   4. Lưu vào product_media_vectors nếu có productId
 *   5. Update embedding_status → 'done' hoặc 'failed'
 */
const { Queue } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');

// =============================================
// Cấu hình — retry nhiều hơn crawl vì phụ thuộc network
// =============================================
const EMBEDDING_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 3000, // 3s → 6s → 12s → 24s → 48s
  },
  removeOnComplete: { age: 1800, count: 200 }, // 30 phút
  removeOnFail: { age: 86400, count: 500 },
};

let _embeddingQueue = null;

const getEmbeddingQueue = () => {
  if (!_embeddingQueue) {
    _embeddingQueue = new Queue('embedding', {
      connection: getRedisConnection(),
      defaultJobOptions: EMBEDDING_JOB_OPTIONS,
    });
  }
  return _embeddingQueue;
};

/**
 * Thêm 1 embedding job vào queue
 */
const addEmbeddingJob = async ({ mediaId, postId, pageId, userId, imageUrl, productId = null, productName = null }) => {
  const queue = getEmbeddingQueue();

  // jobId = mediaId để tránh trùng lặp
  const job = await queue.add(
    'embed-image',
    { mediaId, postId, pageId, userId, imageUrl, productId, productName },
    { jobId: `embed:${mediaId}` },
  );

  return job.id;
};

/**
 * Thêm nhiều embedding jobs cùng lúc (bulk)
 * Hiệu quả hơn gọi addEmbeddingJob nhiều lần
 */
const addEmbeddingJobsBulk = async (items) => {
  if (!items || items.length === 0) return [];

  const queue = getEmbeddingQueue();

  const jobs = items.map((item) => ({
    name: 'embed-image',
    data: {
      mediaId: item.mediaId,
      postId: item.postId,
      pageId: item.pageId,
      userId: item.userId,
      imageUrl: item.imageUrl,
      productId: item.productId || null,
      productName: item.productName || null,
    },
    opts: {
      ...EMBEDDING_JOB_OPTIONS,
      jobId: `embed:${item.mediaId}`,
    },
  }));

  const added = await queue.addBulk(jobs);
  return added.map((j) => j.id);
};

/**
 * Retry tất cả failed embedding jobs
 * Dùng cho debug endpoint
 */
const retryFailedEmbeddingJobs = async () => {
  const queue = getEmbeddingQueue();
  const failed = await queue.getFailed(0, 499);
  let retried = 0;
  for (const job of failed) {
    await job.retry();
    retried++;
  }
  return retried;
};

/**
 * Thống kê embedding queue
 */
const getEmbeddingQueueStats = async () => {
  const queue = getEmbeddingQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
};

module.exports = {
  getEmbeddingQueue,
  addEmbeddingJob,
  addEmbeddingJobsBulk,
  retryFailedEmbeddingJobs,
  getEmbeddingQueueStats,
};
