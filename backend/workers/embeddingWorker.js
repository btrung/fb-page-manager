/**
 * Embedding Worker — xử lý CLIP image embedding jobs
 *
 * Luồng:
 *  1. Nhận job { mediaId, postId, pageId, userId, imageUrl, productId, productName }
 *  2. Gọi AI service POST /embed/image
 *  3. Nhận vector 512d từ CLIP
 *  4. Lưu vector vào post_media.image_embedding (PostgreSQL)
 *  5. Lưu vào product_media_vectors nếu có productId
 *  6. Update embedding_status → 'done' hoặc 'failed'
 *
 * Retry: 5 lần với exponential backoff (cấu hình trong embeddingQueue.js)
 */
const axios = require('axios');
const { Worker } = require('bullmq');
const { getRedisConnection } = require('../queues/redisConnection');
const {
  updateMediaEmbeddingStatus,
  saveProductMediaVector,
  linkPostToProduct,
} = require('../db/intelligenceDB');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// =============================================
// Helper: gọi AI service embed 1 ảnh
// =============================================
const callEmbedImage = async ({ mediaId, imageUrl, postId, pageId, userId, productId, productName }) => {
  const response = await axios.post(
    `${AI_SERVICE_URL}/embed/image`,
    { media_id: mediaId, image_url: imageUrl, post_id: postId, page_id: pageId, user_id: userId, product_id: productId, product_name: productName },
    { timeout: 60000 }, // 1 phút — ảnh cần download + CLIP encode
  );
  return response.data;
};

// =============================================
// Processor
// =============================================
const processEmbeddingJob = async (job) => {
  const { mediaId, postId, pageId, userId, imageUrl, productId, productName } = job.data;

  try {
    // Gọi AI service — download ảnh, CLIP encode, lưu Qdrant
    const result = await callEmbedImage({
      mediaId, imageUrl, postId, pageId, userId, productId, productName,
    });

    if (!result.success) {
      // AI service xử lý được nhưng embed thất bại (ảnh xấu, URL expired)
      await updateMediaEmbeddingStatus(mediaId, 'failed');
      console.warn(`[EMBED WORKER] media ${mediaId} embed thất bại: ${result.message}`);
      return { success: false, mediaId, reason: result.message };
    }

    // Lấy vector từ Qdrant response (AI service đã lưu Qdrant, trả về dim)
    // Lưu status vào PostgreSQL post_media (không lưu lại vector — đã có trong Qdrant)
    await updateMediaEmbeddingStatus(mediaId, 'done');

    // Nếu có liên kết sản phẩm, lưu vào product_media_vectors
    if (productId && productName) {
      await saveProductMediaVector({
        productId,
        productName,
        postId,
        pageId,
        imageUrl,
        imageEmbedding: null,  // vector đã ở Qdrant, không lưu lại PostgreSQL để tiết kiệm dung lượng
        isPrimary: false,
        similarityScore: null,
      });
    }

    return { success: true, mediaId, vectorDim: result.vector_dim };

  } catch (err) {
    // Lỗi network hoặc AI service down → BullMQ sẽ retry
    // Chỉ mark failed sau khi hết retry
    if (job.attemptsMade >= (job.opts?.attempts || 5) - 1) {
      await updateMediaEmbeddingStatus(mediaId, 'failed').catch(() => {});
      console.error(`[EMBED WORKER] media ${mediaId} hết retry, đánh dấu failed`);
    }

    console.error(`[EMBED WORKER] Job ${job.id} lỗi (attempt ${job.attemptsMade + 1}): ${err.message}`);
    throw err; // BullMQ sẽ retry
  }
};

// =============================================
// Khởi động embedding worker
// =============================================
const startEmbeddingWorker = () => {
  const worker = new Worker('embedding', processEmbeddingJob, {
    connection: getRedisConnection(),
    // Concurrency cao hơn crawl vì mỗi job nhẹ hơn (1 ảnh)
    concurrency: 10,
    limiter: {
      max: 20,       // Tối đa 20 ảnh/giây
      duration: 1000,
    },
  });

  worker.on('completed', (job, result) => {
    if (result?.success) {
      console.log(`[EMBED WORKER] ✅ media ${result.mediaId} (${result.vectorDim}d)`);
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[EMBED WORKER] ❌ Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[EMBED WORKER] Started, concurrency=10');
  return worker;
};

module.exports = { startEmbeddingWorker, processEmbeddingJob };
