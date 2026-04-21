/**
 * Crawl Worker — xử lý job crawl 500 posts từ Facebook fanpage
 *
 * Luồng xử lý:
 *  1. Fetch posts từ FB Graph API (pagination theo cursor)
 *  2. Lọc bỏ post_id đã có trong DB (skip)
 *  3. Gọi AI /extract/batch để lấy LLM fields (batch 20 posts)
 *  4. Filter: bỏ non-sale, video, >5 ảnh
 *  5. insertPost + upsertProduct + linkPostToProduct
 *  6. Enqueue ảnh vào embeddingQueue (bulk)
 *  7. Update crawl_log
 *
 * Idempotent: crash và restart không tạo dữ liệu trùng
 */
const axios = require('axios');
const { Worker } = require('bullmq');
const { getRedisConnection } = require('../queues/redisConnection');
const { addEmbeddingJobsBulk } = require('../queues/embeddingQueue');
const {
  insertPost,
  getExistingPostIds,
  savePostMediaBatch,
  createCrawlLog,
  updateCrawlLog,
} = require('../db/intelligenceDB');

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Số posts gửi LLM mỗi batch (tránh timeout)
const LLM_BATCH_SIZE = 20;
// Số posts fetch mỗi page từ FB API
const FB_PAGE_SIZE = 100;

// =============================================
// Helper: trích xuất image URLs từ attachments FB
// =============================================
const extractMediaInfo = (post) => {
  const attachments = post.attachments?.data || [];
  const imageUrls = [];
  let hasVideo = false;
  let mediaType = 'text';

  for (const att of attachments) {
    const type = att.media_type || att.type || '';

    if (type === 'video' || type === 'animated_image_video') {
      hasVideo = true;
      mediaType = 'video';
      continue;
    }

    // Ảnh đơn
    if (att.media?.image?.src) {
      imageUrls.push(att.media.image.src);
      mediaType = 'photo';
    }

    // Album nhiều ảnh (subattachments)
    if (att.subattachments?.data) {
      for (const sub of att.subattachments.data) {
        if (sub.media?.image?.src) {
          imageUrls.push(sub.media.image.src);
        }
        if (sub.media_type === 'video') hasVideo = true;
      }
      if (att.subattachments.data.length > 0) mediaType = 'album';
    }
  }

  return { imageUrls, hasVideo, mediaType, imageCount: imageUrls.length };
};

// =============================================
// Helper: fetch posts từ FB với pagination
// =============================================
const fetchPostsFromFB = async (pageId, pageAccessToken, limit = 500) => {
  const fields = [
    'id', 'message', 'story', 'created_time', 'full_picture',
    'permalink_url', 'likes.summary(true)', 'comments.summary(true)',
    'shares',
    'attachments{media_type,media{image},subattachments{media_type,media{image}},type}',
  ].join(',');

  const posts = [];
  let after = null;
  let fetched = 0;

  while (fetched < limit) {
    const pageLimit = Math.min(FB_PAGE_SIZE, limit - fetched);
    const params = {
      fields,
      limit: pageLimit,
      access_token: pageAccessToken,
    };
    if (after) params.after = after;

    const response = await axios.get(`${GRAPH_API}/${pageId}/posts`, {
      params,
      timeout: 30000,
    });

    const data = response.data.data || [];
    if (data.length === 0) break;

    posts.push(...data);
    fetched += data.length;

    // Lấy cursor trang tiếp theo
    after = response.data.paging?.cursors?.after;
    if (!after || !response.data.paging?.next) break;
  }

  return posts;
};

// =============================================
// Helper: gọi AI service /extract/batch
// =============================================
const callLLMBatch = async (posts) => {
  const payload = {
    posts: posts.map((p) => ({
      post_id: p.id,
      text: p.message || p.story || '',
      image_urls: p._imageUrls || [],
    })),
  };

  // Log input gửi LLM
  for (const p of payload.posts) {
    console.log(`[LLM INPUT] post_id=${p.post_id}`);
    console.log(`  text: ${p.text.slice(0, 200)}${p.text.length > 200 ? '...' : ''}`);
    console.log(`  image_urls (${p.image_urls.length}): ${p.image_urls.join(', ') || '(none)'}`);
  }

  const response = await axios.post(`${AI_SERVICE_URL}/extract/batch`, payload, {
    timeout: 120000,
  });

  // Log output LLM trả về
  for (const r of response.data.results || []) {
    console.log(`[LLM OUTPUT] post_id=${r.post_id}`);
    console.log(`  is_sale_post=${r.is_sale_post} | product="${r.extracted_product_name}" | price=${r.price} | count=${r.product_count}`);
    console.log(`  what_is_product: ${r.what_is_product || '(null)'}`);
    console.log(`  what_is_promotion: ${r.what_is_promotion || '(null)'}`);
  }

  // Map kết quả về theo post_id
  const resultMap = {};
  for (const r of response.data.results || []) {
    resultMap[r.post_id] = r;
  }
  return resultMap;
};

// =============================================
// Main worker processor
// =============================================
const processCrawlJob = async (job) => {
  const { userId, pageId, pageAccessToken, limit = 500 } = job.data;
  const startTime = Date.now();

  const logId = await createCrawlLog({ userId, pageId, jobId: job.id });

  const stats = {
    postsCrawled: 0,
    postsSaved: 0,
    postsSkipped: 0,
    mediaProcessed: 0,
    mediaEnqueued: 0,
  };

  try {
    // ─── Bước 1: Lấy danh sách post_id đã có trong DB ───────────────
    await job.updateProgress(5);
    const existingIds = await getExistingPostIds(userId, pageId);
    console.log(`[CRAWL] ${pageId}: ${existingIds.size} posts đã có trong DB`);

    // ─── Bước 2: Fetch posts từ Facebook ────────────────────────────
    await job.updateProgress(10);
    const rawPosts = await fetchPostsFromFB(pageId, pageAccessToken, limit);
    stats.postsCrawled = rawPosts.length;
    console.log(`[CRAWL] ${pageId}: fetch được ${rawPosts.length} posts`);

    // ─── Bước 3: Tiền xử lý — skip đã có, gắn media info ───────────
    const newPosts = [];
    for (const post of rawPosts) {
      if (existingIds.has(post.id)) {
        stats.postsSkipped++;
        continue;
      }
      const { imageUrls, hasVideo, mediaType, imageCount } = extractMediaInfo(post);
      post._imageUrls = imageUrls;
      post._hasVideo = hasVideo;
      post._mediaType = mediaType;
      post._imageCount = imageCount;
      newPosts.push(post);
    }

    console.log(`[CRAWL] ${pageId}: ${newPosts.length} posts mới cần xử lý`);
    if (newPosts.length === 0) {
      await updateCrawlLog(logId, { status: 'completed', ...stats, timeTaken: (Date.now() - startTime) / 1000 });
      return stats;
    }

    // ─── Bước 4: Gọi LLM theo batch ─────────────────────────────────
    const embeddingJobs = [];
    let batchIdx = 0;

    for (let i = 0; i < newPosts.length; i += LLM_BATCH_SIZE) {
      const batch = newPosts.slice(i, i + LLM_BATCH_SIZE);

      // Cập nhật progress theo %
      const pct = 15 + Math.round((batchIdx / Math.ceil(newPosts.length / LLM_BATCH_SIZE)) * 70);
      await job.updateProgress(Math.min(pct, 85));

      let llmResults = {};
      try {
        llmResults = await callLLMBatch(batch);
      } catch (err) {
        console.error(`[CRAWL] LLM batch ${batchIdx} thất bại:`, err.message);
        // Tiếp tục xử lý các batch khác, batch này sẽ bị skip
      }

      // ─── Bước 5: Xử lý từng post trong batch ──────────────────────
      for (const post of batch) {
        const llm = llmResults[post.id] || {};

        // ── Filter 1: bỏ video ──
        if (post._hasVideo) {
          stats.postsSkipped++;
          continue;
        }

        // ── Filter 2: bỏ post có hơn 5 ảnh ──
        if (post._imageCount > 5) {
          stats.postsSkipped++;
          continue;
        }

        // ── Filter 3: bỏ non-sale post ──
        if (llm.is_sale_post === false) {
          stats.postsSkipped++;
          continue;
        }

        // ── Lưu post vào DB ──
        const result = await insertPost({
          postId: post.id,
          pageId,
          userId,
          content: post.message || post.story || '',
          pictureUrl: post.full_picture || null,
          permalink: post.permalink_url || null,
          likes: post.likes?.summary?.total_count || 0,
          comments: post.comments?.summary?.total_count || 0,
          shares: post.shares?.count || 0,
          postCreatedTimeOnFb: post.created_time || null,
          isSalePost: llm.is_sale_post ?? null,
          isSingleProductPost: (llm.product_count === 1) || null,
          productCount: llm.product_count || 0,
          extractedProductName: llm.extracted_product_name || null,
          price: llm.price || null,
          whatIsProduct: llm.what_is_product || null,
          whatIsPromotion: llm.what_is_promotion || null,
        });

        if (result === 'skipped') {
          stats.postsSkipped++;
          continue;
        }

        stats.postsSaved++;

        // ── Embed text post (best-effort) ──
        const postText = [
          post.message || post.story || '',
          llm.what_is_product || '',
          llm.what_is_promotion || '',
        ].filter(Boolean).join('\n');

        if (postText.trim()) {
          axios.post(`${AI_SERVICE_URL}/embed/post-text`, {
            post_id: post.id,
            text: postText,
            page_id: pageId,
            user_id: userId,
            product_name: llm.extracted_product_name || null,
            product_id: null,
            is_sale_post: llm.is_sale_post ?? false,
            current_price: llm.price || null,
          }, { timeout: 120000 }).catch((err) => {
            console.warn(`[CRAWL] Text embed thất bại post ${post.id}: ${err.message}`);
          });
        }

        // ── Lưu ảnh vào post_media (pending embedding) ──
        // Dedup theo path URL — FB CDN trả về cùng ảnh với query params khác nhau
        const uniqueImageUrls = [...new Map(post._imageUrls.map(u => [u.split('?')[0], u])).values()];
        if (uniqueImageUrls.length > 0) {
          const savedMedia = await savePostMediaBatch(post.id, pageId, userId, uniqueImageUrls);
          stats.mediaProcessed += savedMedia.length;

          for (const { mediaId, imageUrl } of savedMedia) {
            embeddingJobs.push({
              mediaId,
              postId: post.id,
              pageId,
              userId,
              imageUrl,
              productName: llm.extracted_product_name || null,
            });
          }
        }
      }

      batchIdx++;
    }

    // ─── Bước 6: Enqueue embedding jobs (bulk) ──────────────────────
    if (embeddingJobs.length > 0) {
      await addEmbeddingJobsBulk(embeddingJobs);
      stats.mediaEnqueued = embeddingJobs.length;
      console.log(`[CRAWL] Enqueued ${embeddingJobs.length} embedding jobs`);
    }

    await job.updateProgress(100);

    const timeTaken = (Date.now() - startTime) / 1000;
    await updateCrawlLog(logId, {
      status: 'completed',
      postsCrawled: stats.postsCrawled,
      postsSaved: stats.postsSaved,
      postsSkipped: stats.postsSkipped,
      mediaProcessed: stats.mediaProcessed,
      mediaEmbedded: 0, // embedding worker sẽ cập nhật riêng
      timeTaken,
    });

    console.log(`[CRAWL] ${pageId} xong: saved=${stats.postsSaved} skip=${stats.postsSkipped} media=${stats.mediaProcessed} time=${timeTaken.toFixed(1)}s`);
    return stats;

  } catch (err) {
    const timeTaken = (Date.now() - startTime) / 1000;
    await updateCrawlLog(logId, {
      status: 'failed',
      ...stats,
      timeTaken,
      errorMessage: err.message,
    }).catch(() => {});

    console.error(`[CRAWL] Job ${job.id} thất bại:`, err.message);
    throw err; // BullMQ sẽ retry theo config
  }
};

// =============================================
// Khởi động worker
// =============================================
const startCrawlWorker = () => {
  const worker = new Worker('crawl', processCrawlJob, {
    connection: getRedisConnection(),
    concurrency: 2, // Tối đa 2 crawl jobs song song
    limiter: {
      max: 5,       // Tối đa 5 jobs/giây (tuân thủ FB rate limit)
      duration: 1000,
    },
  });

  worker.on('completed', (job, result) => {
    console.log(`[CRAWL WORKER] Job ${job.id} completed:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[CRAWL WORKER] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });

  worker.on('progress', (job, progress) => {
    console.log(`[CRAWL WORKER] Job ${job.id} progress: ${progress}%`);
  });

  console.log('[CRAWL WORKER] Started, concurrency=2');
  return worker;
};

module.exports = { startCrawlWorker, processCrawlJob };
