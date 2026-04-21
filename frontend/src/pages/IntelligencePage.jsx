import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import LoadingSpinner from '../components/LoadingSpinner';
import { intelligenceApi, pagesApi } from '../utils/api';

const TABS = { POSTS: 'posts', LOGS: 'logs' };

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

const AI_LEVELS = [
  { min: 0,   max: 0,   emoji: '🦴', label: 'Người Tối Cổ',        desc: 'AI chưa biết gì về fanpage này', color: 'text-stone-500',  bg: 'bg-stone-50',  border: 'border-stone-200' },
  { min: 1,   max: 10,  emoji: '🪨', label: 'Người Thời Đồ Đá',    desc: 'AI mới bắt đầu lờ mờ hiểu', color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  { min: 11,  max: 30,  emoji: '🧑', label: 'Người Hiện Đại',       desc: 'AI đang học khá tốt rồi', color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200'  },
  { min: 31,  max: 100, emoji: '🚀', label: 'Người Tương Lai',      desc: 'AI thông minh, hiểu fanpage rõ', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200'},
  { min: 101, max: Infinity, emoji: '👽', label: 'Người Ngoài Hành Tinh', desc: 'AI siêu thông minh, hiểu khách hàng cực tốt', color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200'  },
];

const getAILevel = (processedPosts) => {
  return AI_LEVELS.find((l) => processedPosts >= l.min && processedPosts <= l.max) || AI_LEVELS[0];
};

const AILevelBadge = ({ summary }) => {
  const count = summary?.processedPosts ?? 0;
  const [overrideIdx, setOverrideIdx] = useState(null);
  const [evolving, setEvolving] = useState(false);

  const level = overrideIdx !== null ? AI_LEVELS[overrideIdx] : getAILevel(count);

  const handleEvolve = () => {
    if (evolving) return;
    setEvolving(true);
    setOverrideIdx(0);
    let i = 0;
    const tick = () => {
      i++;
      if (i < AI_LEVELS.length) {
        setOverrideIdx(i);
        setTimeout(tick, 350);
      } else {
        setEvolving(false);
      }
    };
    setTimeout(tick, 350);
  };

  return (
    <div className={`rounded-xl border ${level.border} ${level.bg} p-4 flex items-center gap-4 transition-all duration-300`}>
      <span className={`text-4xl transition-all duration-300 ${evolving ? 'scale-125' : 'scale-100'}`}>{level.emoji}</span>
      <div className="flex-1">
        <p className={`font-bold text-base ${level.color}`}>{level.label}</p>
        <p className="text-sm text-gray-500">{level.desc}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className={`text-2xl font-bold ${level.color}`}>{count}</p>
          <p className="text-xs text-gray-400">bài đã học</p>
        </div>
        <button
          onClick={handleEvolve}
          disabled={evolving}
          title="Hốc Đá cho AI"
          className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700 disabled:opacity-40 transition-all whitespace-nowrap"
        >
          🪨 Hốc Đá
        </button>
      </div>
    </div>
  );
};

const CrawlPanel = ({ pageId, onCrawlComplete }) => {
  const [jobId, setJobId]         = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [crawling, setCrawling]   = useState(false);
  const [error, setError]         = useState('');
  const [resetting, setResetting] = useState(false);
  const sseRef = useRef(null);

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

  const handleLearn = async () => {
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
        setError(`Đang học rồi (${res.data.state}). Chờ hoàn thành nhé.`);
        return;
      }

      startSSE(id);
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi bắt đầu học');
      setCrawling(false);
    }
  };

  const handleRelearn = async () => {
    if (!window.confirm('AI sẽ quên hết và học lại từ đầu. Xác nhận?')) return;
    setResetting(true);
    setError('');
    setJobStatus(null);
    try {
      await intelligenceApi.deleteAllData();
      onCrawlComplete?.();
      // Tự động crawl lại sau khi xóa
      const res = await intelligenceApi.triggerCrawl(pageId, 500);
      const id = res.data.jobId;
      setJobId(id);
      setCrawling(true);
      startSSE(id);
    } catch (err) {
      setError(err.response?.data?.error || 'Lỗi khi học lại');
      setCrawling(false);
    } finally {
      setResetting(false);
    }
  };

  const stateLabel = {
    waiting: 'Đang chuẩn bị...',
    active: 'AI đang học...',
    completed: 'Học xong rồi! 🎉',
    failed: 'Học thất bại',
  };

  const busy = crawling || resetting;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">Huấn luyện AI</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            AI đọc hiểu 500 bài đăng, tự học sản phẩm & khách hàng của fanpage
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRelearn}
            disabled={busy}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {resetting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {resetting ? 'Đang reset...' : '🔄 AI Học Lại'}
          </button>
          <button
            onClick={handleLearn}
            disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {crawling && !resetting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {crawling && !resetting ? 'AI đang học...' : '🧠 AI Học Fanpage'}
          </button>
        </div>
      </div>

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
                { label: 'Bài mới học', value: jobStatus.returnvalue.postsSaved, color: 'text-green-600' },
                { label: 'Bỏ qua', value: jobStatus.returnvalue.postsSkipped, color: 'text-gray-500' },
                { label: 'Ảnh đang xử lý', value: jobStatus.returnvalue.mediaEnqueued, color: 'text-blue-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-lg py-2">
                  <p className={`text-lg font-bold ${color}`}>{value ?? '—'}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}

          {jobStatus.state === 'failed' && (
            <p className="text-xs text-red-600 mt-1">Lỗi: {jobStatus.failedReason}</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
};

const SummaryStats = ({ summary }) => {
  if (!summary) return null;
  const stats = [
    { label: 'Bài bán hàng', value: summary.salePosts, color: 'text-blue-600' },
    { label: 'Đã xử lý AI', value: summary.processedPosts, color: 'text-purple-600' },
    { label: 'Ảnh đã embed', value: summary.embeddedImages, color: 'text-orange-600' },
    { label: 'Ảnh đang chờ', value: summary.pendingImages, color: 'text-yellow-600' },
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

const IntelligencePage = () => {
  const { pageId } = useParams();
  const [tab, setTab]         = useState(TABS.POSTS);
  const [summary, setSummary] = useState(null);
  const [posts, setPosts]     = useState([]);
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageName, setPageName] = useState('');

  useEffect(() => {
    intelligenceApi.getSummary().then((r) => setSummary(r.data)).catch(() => {});
    pagesApi.getPages().then((r) => {
      const page = r.data.pages?.find((p) => p.id === pageId);
      if (page) setPageName(page.name);
    }).catch(() => {});
  }, [pageId]);

  useEffect(() => {
    loadTabData(tab);
  }, [tab, pageId]);

  const loadTabData = async (activeTab) => {
    setLoading(true);
    try {
      if (activeTab === TABS.POSTS) {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-5">
          <p className="text-sm text-gray-500">AI Học Fanpage</p>
          <h1 className="text-2xl font-bold text-gray-900">{pageName || pageId}</h1>
        </div>

        <div className="mb-5">
          <AILevelBadge summary={summary} />
        </div>

        <SummaryStats summary={summary} />

        <div className="mb-5">
          <CrawlPanel pageId={pageId} onCrawlComplete={handleCrawlComplete} />
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5 w-fit">
          {[
            { key: TABS.POSTS, label: 'Bài đăng' },
            { key: TABS.LOGS,  label: 'Lịch sử' },
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
                            {post.whatIsPromotion.slice(0, 40)}
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
