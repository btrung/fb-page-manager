import React, { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import PageCard from '../components/PageCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { pagesApi } from '../utils/api';

const DashboardPage = () => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    pagesApi.getPages()
      .then((res) => setPages(res.data.pages))
      .catch((err) => {
        const msg = err.response?.data?.error || 'Không thể tải danh sách Pages.';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Facebook Pages của bạn</h1>
          <p className="text-gray-500 text-sm mt-1">
            Chọn một Page để xem và phân tích 50 bài đăng gần nhất
          </p>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" text="Đang tải danh sách Pages..." />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && pages.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="font-medium">Bạn chưa quản lý Page nào</p>
            <p className="text-sm mt-1">Hãy tạo hoặc được thêm làm admin của một Facebook Page</p>
          </div>
        )}

        {!loading && pages.length > 0 && (
          <div className="space-y-3">
            {pages.map((page) => (
              <PageCard key={page.id} page={page} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default DashboardPage;
