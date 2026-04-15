import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import PostCard from '../components/PostCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { pagesApi } from '../utils/api';

const PostsPage = () => {
  const { pageId } = useParams();
  const navigate = useNavigate();

  const [posts, setPosts] = useState([]);
  const [dbInfo, setDbInfo] = useState(null);       // Thông tin từ DB sau khi lưu
  const [dbCheck, setDbCheck] = useState(null);     // Kết quả verify DB
  const [loading, setLoading] = useState(true);
  const [checkingDb, setCheckingDb] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    pagesApi.getPosts(pageId)
      .then((res) => {
        setPosts(res.data.posts);
        setDbInfo(res.data.db); // { saved: 50, message: "Đã lưu 50 bài..." }
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Không thể tải bài đăng.');
      })
      .finally(() => setLoading(false));
  }, [pageId]);

  // Verify dữ liệu trong DB
  const handleCheckDb = async () => {
    setCheckingDb(true);
    try {
      const res = await pagesApi.checkDb(pageId);
      setDbCheck(res.data);
    } catch {
      setDbCheck({ error: 'Không thể kiểm tra DB.' });
    } finally {
      setCheckingDb(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const res = await pagesApi.analyzePosts(pageId, posts);
      setAnalyzeResult(res.data);
    } catch {
      setAnalyzeResult({ error: 'AI Service chưa khả dụng.' });
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredPosts = posts.filter((p) =>
    p.message.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bài đăng gần nhất</h1>
            {!loading && (
              <p className="text-gray-500 text-sm mt-0.5">
                {posts.length} bài đăng · Page ID: {pageId}
              </p>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" text="Đang tải và lưu bài đăng..." />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* === Banner DB Status === */}
            {dbInfo && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-green-800">
                  <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold">{dbInfo.message}</p>
                    <p className="text-xs text-green-600 mt-0.5">Dữ liệu đã được lưu vào SQLite database</p>
                  </div>
                </div>

                {/* Nút verify DB */}
                <button
                  onClick={handleCheckDb}
                  disabled={checkingDb}
                  className="flex-shrink-0 text-xs border border-green-400 text-green-700 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {checkingDb ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4" />
                    </svg>
                  )}
                  Xác nhận trong DB
                </button>
              </div>
            )}

            {/* === Kết quả Check DB === */}
            {dbCheck && !dbCheck.error && (
              <div className="card mb-5 border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-facebook-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4" />
                  </svg>
                  <h3 className="font-semibold text-gray-800 text-sm">
                    Database · {dbCheck.totalInDb} bài đang được lưu
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-gray-600">
                    <thead>
                      <tr className="border-b border-gray-100 text-left">
                        <th className="pb-2 font-semibold text-gray-500 w-8">#</th>
                        <th className="pb-2 font-semibold text-gray-500">Nội dung</th>
                        <th className="pb-2 font-semibold text-gray-500 whitespace-nowrap">Ngày đăng</th>
                        <th className="pb-2 font-semibold text-gray-500 text-right">Likes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbCheck.posts.slice(0, 10).map((p, i) => (
                        <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 text-gray-400">{i + 1}</td>
                          <td className="py-2 pr-3 max-w-xs truncate">
                            {p.message || <span className="text-gray-300 italic">(không có text)</span>}
                          </td>
                          <td className="py-2 whitespace-nowrap text-gray-400">
                            {p.createdTime ? new Date(p.createdTime).toLocaleDateString('vi-VN') : '—'}
                          </td>
                          <td className="py-2 text-right">{p.likes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dbCheck.totalInDb > 10 && (
                    <p className="text-xs text-gray-400 mt-2 text-center">
                      ... và {dbCheck.totalInDb - 10} bài khác trong DB
                    </p>
                  )}
                </div>
              </div>
            )}

            {dbCheck?.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mb-5 text-sm">
                {dbCheck.error}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Tìm kiếm trong bài đăng..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-facebook-blue/30 focus:border-facebook-blue"
                />
              </div>

              <button
                onClick={handleAnalyze}
                disabled={analyzing || posts.length === 0}
                className="btn-primary flex items-center gap-2 whitespace-nowrap"
              >
                {analyzing ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                )}
                Phân tích bằng AI
              </button>
            </div>

            {/* Kết quả AI */}
            {analyzeResult && (
              <div className={`rounded-xl p-4 mb-5 text-sm ${
                analyzeResult.error
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                {analyzeResult.error || `Đã tạo vector cho ${analyzeResult.processed} bài. Có thể tìm kiếm semantic search.`}
              </div>
            )}

            {/* Danh sách posts */}
            {filteredPosts.length === 0 ? (
              <p className="text-center text-gray-400 py-10">
                Không tìm thấy bài đăng nào khớp với từ khóa.
              </p>
            ) : (
              <div className="space-y-4">
                {filteredPosts.map((post, i) => (
                  <PostCard key={post.id} post={post} index={i} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default PostsPage;
