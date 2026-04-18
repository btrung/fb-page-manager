/**
 * Job Manager — in-memory, không cần BullMQ/Redis
 * Crawl job chạy background trong cùng Node.js process
 * Sau này upgrade lên BullMQ chỉ cần đổi file này
 */
const { v4: uuidv4 } = require('uuid');

// Lưu trạng thái jobs trong RAM (mất khi restart, OK cho MVP)
const _jobs = new Map();

// SSE listeners: jobId → Set of callback functions
const _listeners = new Map();

// Giữ tối đa 100 jobs gần nhất để tránh memory leak
const MAX_JOBS = 100;

const createJob = (data) => {
  const jobId = `job_${uuidv4()}`;
  _jobs.set(jobId, {
    jobId,
    state: 'waiting',
    progress: 0,
    data,
    returnvalue: null,
    failedReason: null,
    timestamp: Date.now(),
    processedOn: null,
    finishedOn: null,
  });

  // Dọn jobs cũ nếu quá giới hạn
  if (_jobs.size > MAX_JOBS) {
    const oldest = [..._jobs.keys()][0];
    _jobs.delete(oldest);
  }

  return jobId;
};

const updateJob = (jobId, updates) => {
  const job = _jobs.get(jobId);
  if (!job) return;
  const updated = { ...job, ...updates };
  _jobs.set(jobId, updated);
  // Notify SSE listeners
  const listeners = _listeners.get(jobId);
  if (listeners) listeners.forEach((cb) => cb(updated));
};

const subscribeJob = (jobId, callback) => {
  if (!_listeners.has(jobId)) _listeners.set(jobId, new Set());
  _listeners.get(jobId).add(callback);
};

const unsubscribeJob = (jobId, callback) => {
  _listeners.get(jobId)?.delete(callback);
};

const getJob = (jobId) => _jobs.get(jobId) || null;

/**
 * Chạy 1 async function trong background (non-blocking)
 * processFn nhận object có updateProgress(n) để báo tiến độ
 */
const runBackground = (jobId, processFn) => {
  updateJob(jobId, { state: 'active', processedOn: Date.now() });

  const jobProxy = {
    id: jobId,
    data: _jobs.get(jobId)?.data,
    attemptsMade: 0,
    opts: { attempts: 1 },
    updateProgress: (pct) => updateJob(jobId, { progress: pct }),
  };

  // setImmediate để không block request handler
  setImmediate(async () => {
    try {
      const result = await processFn(jobProxy);
      updateJob(jobId, {
        state: 'completed',
        progress: 100,
        returnvalue: result,
        finishedOn: Date.now(),
      });
    } catch (err) {
      updateJob(jobId, {
        state: 'failed',
        failedReason: err.message,
        finishedOn: Date.now(),
      });
    }
  });
};

module.exports = { createJob, updateJob, getJob, runBackground, subscribeJob, unsubscribeJob };
