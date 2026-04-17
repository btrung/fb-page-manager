/**
 * Crawl Queue — BullMQ
 * Xử lý job crawl 500 posts từ Facebook fanpage
 *
 * Job payload:
 *   { userId, pageId, pageAccessToken, limit, triggeredBy }
 *
 * Job flow:
 *   1. Fetch posts từ FB Graph API (pagination)
 *   2. Gọi AI service /extract/batch → LLM fields
 *   3. Filter theo điều kiện
 *   4. Lưu vào DB
 *   5. Enqueue ảnh vào embeddingQueue
 */
const { Queue, QueueEvents } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');

// =============================================
// Cấu hình mặc định cho crawl jobs
// =============================================
const CRAWL_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000, // 5s → 10s → 20s
  },
  // Giữ job completed trong 1 giờ để debug
  removeOnComplete: { age: 3600, count: 50 },
  // Giữ job failed trong 24 giờ
  removeOnFail: { age: 86400, count: 100 },
};

let _crawlQueue = null;
let _crawlQueueEvents = null;

/**
 * Lấy singleton CrawlQueue
 * Dùng lazy init để tránh kết nối Redis khi module load
 */
const getCrawlQueue = () => {
  if (!_crawlQueue) {
    _crawlQueue = new Queue('crawl', {
      connection: getRedisConnection(),
      defaultJobOptions: CRAWL_JOB_OPTIONS,
    });
  }
  return _crawlQueue;
};

/**
 * Lấy QueueEvents để lắng nghe progress/complete/fail
 */
const getCrawlQueueEvents = () => {
  if (!_crawlQueueEvents) {
    _crawlQueueEvents = new QueueEvents('crawl', {
      connection: getRedisConnection(),
    });
  }
  return _crawlQueueEvents;
};

/**
 * Thêm job crawl mới vào queue
 * Trả về { jobId } để client polling
 */
const addCrawlJob = async ({ userId, pageId, pageAccessToken, limit = 500, triggeredBy = 'manual' }) => {
  const queue = getCrawlQueue();

  // Dùng jobId cố định để tránh chạy 2 job cùng page cùng lúc
  // BullMQ sẽ bỏ qua nếu job cùng ID đang pending/active
  const jobId = `crawl:${userId}:${pageId}`;

  // Kiểm tra job đang chạy không
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return { jobId, alreadyRunning: true, state };
    }
  }

  const job = await queue.add(
    'crawl-page',
    { userId, pageId, pageAccessToken, limit, triggeredBy },
    { jobId },
  );

  return { jobId: job.id, alreadyRunning: false };
};

/**
 * Lấy trạng thái job crawl
 */
const getCrawlJobStatus = async (jobId) => {
  const queue = getCrawlQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    return { found: false };
  }

  const state = await job.getState();
  return {
    found: true,
    jobId: job.id,
    state,
    progress: job.progress || 0,
    data: job.data,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
};

/**
 * Lấy thống kê queue (dùng cho debug endpoint)
 */
const getCrawlQueueStats = async () => {
  const queue = getCrawlQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
};

/**
 * Lấy danh sách failed jobs để retry
 */
const getFailedCrawlJobs = async (limit = 20) => {
  const queue = getCrawlQueue();
  const jobs = await queue.getFailed(0, limit - 1);
  return jobs.map((j) => ({
    jobId: j.id,
    data: j.data,
    failedReason: j.failedReason,
    timestamp: j.timestamp,
  }));
};

module.exports = {
  getCrawlQueue,
  getCrawlQueueEvents,
  addCrawlJob,
  getCrawlJobStatus,
  getCrawlQueueStats,
  getFailedCrawlJobs,
};
