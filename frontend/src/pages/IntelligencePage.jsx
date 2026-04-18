import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { intelligenceApi, pagesApi } from '../utils/api';

// =============================================
// Tab constants
// =============================================
const TABS = { PRODUCTS: 'products', POSTS: 'posts', LOGS: 'logs' };

// =============================================
// Component: Progress Bar
// =============================================
const ProgressBar = ({ progress, state }) => {
  const colorMap = {
    active: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    waiting: 'bg-yellow-400',
  };
  const color = colorMap[state] || 'bg-gray-400';

  return (
    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

// =============================================
// Component: CrawlPanel
// =============================================
const CrawlPanel = ({ pageId, onCrawlComplete }) => {
  const [jobId, setJobId]       = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [crawling, setCrawling] = useState(false);
  const [error, setError]       = useState('');
  const [deleting, setDeleting] = useState(false);
  const sseRef = useRef(null);

  // Đóng SSE khi unmount
  useEffect(() => () => sseRef.current?.close(), []);

  const startSSE = useCallback((id) => {
    sseRef.current?.close();
    const es = new EventSource(`/api/intelligence/status/${id}/stream`, { withCredentials: true });
    sseRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setJobStatus(data);
      if (data.state === 'completed' || data.state === 'failed') {
        es.close();
        setCrawling(false);
        if (data.state === 'completed') onCrawlComplete?.();
      }
    };

    es.onerror = () => {
      es.close();
      setCrawling(false);
    };
  }, [onCrawlComplete]);

  const handleDelete = async () => {
    if (!window.confirm('Xóa toàn bộ dữ liệu của bạn? Hành động này không thể hoàn tác.')) return;
    setDeleting(true);
    setError('');
    try {
      await intelligenceApi.deleteAllData();
      onCrawlComplete?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi xóa dữ liệu');
    } finally {
      setDeleting(false);
    }
  };

  const handleCrawl = async () => {
    setError('');
    setCrawling(true);
    setJobStatus(null);
    try {
      const res = await intelligenceApi.triggerCrawl(pageId, 500);
      const id = res.data.jobId;
      setJobId(id);

      if (res.data.alreadyRunning) {
        setJobStatus({ state: res.data.state, progress: 0 });
        setCrawling(false);
        setError(`Job đang chạy (${res.data.state}). Chờ hoàn thành.`);
        return;
      }

      startSSE(id);
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi trigger crawl');
      setCrawling(false);
    }
  };

  const stateLabel = {
    waiting: 'Đang chờ...',
    active: 'Đang xử lý...',
    completed: 'Hoàn thành!',
    failed: 'Thất bại',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">Crawl & Phân tích Posts</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Thu thập 500 bài đăng, trích xuất sản phẩm bằng AI
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting || crawling}
            className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {deleting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {deleting ? 'Đang xóa...' : '🗑️ Xóa dữ liệu'}
          </button>
          <button
            onClick={handleCrawl}
            disabled={crawling}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {crawling && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {crawling ? 'Đang chạy...' : '🚀 Crawl 500 Posts'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {jobStatus && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{stateLabel[jobStatus.state] || jobStatus.state}</span>
            <span>{jobStatus.progress || 0}%</span>
          </div>
          <ProgressBar progress={jobStatus.progress || 0} state={jobStatus.state} />

          {jobStatus.state === 'completed' && jobStatus.returnvalue && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Đã lưu', value: jobStatus.returnvalue.postsSaved, color: 'text-green-600' },
                { label: 'Bỏ qua', value: jobStatus.returnvalue.postsSkipped, color: 'text-gray-500' },
                { label: 'Ảnh xếp hàng', value: jobStatus.returnvalue.mediaEnqueued, color: 'text-blue-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-lg py-2">
                  <p className={`text-lg font-bold ${color}`}>{value ?? '—'}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}

          {jobStatus.state === 'failed' && (
            <p className="text-xs text-red-600 mt-1">
              Lỗi: {jobStatus.failedReason}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
};

// =============================================
// Component: Summary Stats
// =============================================
const SummaryStats = ({ summary }) => {
  if (!summary) return null;
  const stats = [
    { label: 'Bài bán hàng', value: summary.salePosts, color: 'text-blue-600' },
    { label: 'Đã xử lý AI', value: summary.processedPosts, color: 'text-purple-600' },
    { label: 'Sản phẩm', value: summary.totalProducts, color: 'text-green-600' },
    { label: 'Ảnh đã embed', value: summary.embeddedImages, color: 'text-orange-600' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className={`text-2xl font-bold ${color}`}>{value ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
};

// =============================================
// Main Page
// =============================================
const IntelligencePage = () => {
  const { pageId } = useParams();
  const [tab, setTab]           = useState(TABS.PRODUCTS);
  const [summary, setSummary]   = useState(null);
  const [products, setProducts] = useState([]);
  const [posts, setPosts]       = useState([]);
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [pageName, setPageName] = useState('');

  // Tải summary + tên page khi mount
  useEffect(() => {
    intelligenceApi.getSummary().then((r) => setSummary(r.data)).catch(() => {});
    pagesApi.getPages().then((r) => {
      const page = r.data.pages?.find((p) => p.id === pageId);
      if (page) setPageName(page.name);
    }).catch(() => {});
  }, [pageId]);

  // Load data theo tab
  useEffect(() => {
    loadTabData(tab);
  }, [tab, pageId]);

  const loadTabData = async (activeTab) => {
    setLoading(true);
    try {
      if (activeTab === TABS.PRODUCTS) {
        const r = await intelligenceApi.getProducts({ search });
        setProducts(r.data.products || []);
      } else if (activeTab === TABS.POSTS) {
        const r = await intelligenceApi.getPosts({ pageId, saleOnly: false });
        setPosts(r.data.posts || []);
      } else if (activeTab === TABS.LOGS) {
        const r = await intelligenceApi.getLogs(pageId);
        setLogs(r.data.logs || []);
      }
    } catch (err) {
      console.error('Load tab error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCrawlComplete = () => {
    intelligenceApi.getSummary().then((r) => setSummary(r.data)).catch(() => {});
    loadTabData(tab);
  };

  const handleSearch = (e) => {
    if (e.key === 'Enter') {
      intelligenceApi.getProducts({ search }).then((r) => setProducts(r.data.products || []));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-5">
          <p className="text-sm text-gray-500">Product Intelligence</p>
          <h1 className="text-2xl font-bold text-gray-900">
            {pageName || pageId}
          </h1>
        </div>

        {/* Summary stats */}
        <SummaryStats summary={summary} />

        {/* Crawl panel */}
        <div className="mb-5">
          <CrawlPanel pageId={pageId} onCrawlComplete={handleCrawlComplete} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5 w-fit">
          {[
            { key: TABS.PRODUCTS, label: '🛍 Sản phẩm' },
            { key: TABS.POSTS,    label: '📄 Bài đăng' },
            { key: TABS.LOGS,     label: '📋 Lịch sử' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab: Products */}
        {tab === TABS.PRODUCTS && (
          <div>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Tìm sản phẩm..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearch}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                onClick={() => intelligenceApi.getProducts({ search }).then((r) => setProducts(r.data.products || []))}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Tìm
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : products.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">🛍</p>
                <p className="font-medium">Chưa có sản phẩm nào</p>
                <p className="text-sm mt-1">Crawl posts để AI trích xuất sản phẩm</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {products.map((p) => (
                  <ProductCard key={p.productId} product={p} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Posts */}
        {tab === TABS.POSTS && (
          <div>
            {loading ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : posts.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">📄</p>
                <p className="font-medium">Chưa có bài đăng nào được xử lý</p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <div
                    key={post.postId}
                    className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4"
                  >
                    {post.pictureUrl && (
                      <img
                        src={post.pictureUrl}
                        alt=""
                        className="w-20 h-20 rounded-lg object-cover shrink-0"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 line-clamp-2 mb-2">
                        {post.content || '(Không có nội dung)'}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {post.extractedProductName && (
                          <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {post.extractedProductName}
                          </span>
                        )}
                        {post.price && (
                          <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(post.price)}
                          </span>
                        )}
                        {post.whatIsPromotion && (
                          <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">
                            🎁 {post.whatIsPromotion.slice(0, 40)}
                          </span>
                        )}
                        <span className="text-gray-400">
                          {post.imageCount} ảnh · {post.embeddedImages} đã embed
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Logs */}
        {tab === TABS.LOGS && (
          <div>
            {loading ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">📋</p>
                <p className="font-medium">Chưa có lịch sử crawl</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.logId}
                    className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        log.status === 'completed' ? 'bg-green-500' :
                        log.status === 'failed'    ? 'bg-red-500' : 'bg-yellow-400'
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {log.status === 'completed' ? '✅' : log.status === 'failed' ? '❌' : '⏳'}{' '}
                          {log.postsSaved} lưu · {log.postsSkipped} bỏ qua · {log.mediaProcessed} ảnh
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(log.createdAt).toLocaleString('vi-VN')}
                          {log.timeTaken ? ` · ${log.timeTaken.toFixed(1)}s` : ''}
                        </p>
                      </div>
                    </div>
                    {log.errorMessage && (
                      <p className="text-xs text-red-500 max-w-xs truncate">{log.errorMessage}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default IntelligencePage;
