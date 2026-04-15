import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID;

const ERROR_MESSAGES = {
  permission_denied: 'Bạn đã từ chối cấp quyền. Vui lòng thử lại.',
  auth_failed: 'Đăng nhập thất bại. Vui lòng thử lại.',
};

const LoginPage = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(searchParams.get('error') ? ERROR_MESSAGES[searchParams.get('error')] : null);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  // Load Facebook JS SDK
  useEffect(() => {
    if (window.FB) return;

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: FACEBOOK_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      });
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/vi_VN/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  const handleLogin = () => {
    if (!window.FB) {
      setError('Facebook SDK chưa tải xong. Vui lòng thử lại.');
      return;
    }

    setLoading(true);
    setError(null);

    window.FB.login(
      async (response) => {
        if (response.authResponse) {
          const { accessToken } = response.authResponse;
          try {
            // Gửi token lên backend để tạo session
            const res = await api.post('/auth/facebook/token', { accessToken });
            setUser(res.data.user);
            navigate('/dashboard');
          } catch {
            setError('Đăng nhập thất bại. Vui lòng thử lại.');
            setLoading(false);
          }
        } else {
          setError('Bạn đã huỷ đăng nhập.');
          setLoading(false);
        }
      },
      {
        scope: 'public_profile,email,pages_show_list,pages_read_engagement',
      }
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-facebook-blue to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-facebook-light rounded-2xl mb-4">
            <svg className="w-10 h-10 text-facebook-blue" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FB Page Manager</h1>
          <p className="text-gray-500 text-sm mt-1">Quản lý và phân tích nội dung Facebook Pages</p>
        </div>

        {/* Lỗi */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* Nút login */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-3 text-base"
        >
          {loading ? (
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          )}
          {loading ? 'Đang đăng nhập...' : 'Đăng nhập với Facebook'}
        </button>

        {/* Quyền */}
        <div className="mt-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quyền truy cập cần thiết</p>
          <ul className="space-y-1.5">
            {[
              { icon: '👤', text: 'Thông tin hồ sơ cơ bản' },
              { icon: '📋', text: 'Danh sách Pages bạn quản lý' },
              { icon: '📝', text: 'Đọc bài viết và tương tác của Pages' },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-2 text-xs text-gray-600">
                <span>{item.icon}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-gray-400 text-center mt-4">
          Bằng cách đăng nhập, bạn đồng ý với{' '}
          <a href="/privacy" className="text-facebook-blue hover:underline">Chính sách bảo mật</a> của chúng tôi.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
