import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChatBadge } from '../context/ChatBadgeContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { dungCount } = useChatBadge();

  const NAV_TABS = [
    { label: '🧠 AI Học',    to: '/dashboard', badge: 0 },
    { label: '💬 Hội Thoại', to: '/chat',       badge: dungCount },
    { label: '⚙️ Cài đặt',   to: '/settings',   badge: 0 },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Match tab: /pages/:pageId/intelligence → /dashboard tab
  const activeTab = (to) => {
    if (to === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/pages/');
    return pathname.startsWith(to);
  };

  return (
    <nav className="bg-facebook-blue shadow-md shrink-0">
      <div className="max-w-full px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-white font-bold text-base tracking-tight shrink-0">
            FB Page Manager
          </Link>

          {user && (
            <div className="flex items-center gap-1">
              {NAV_TABS.map((tab) => (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`relative text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    activeTab(tab.to)
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {tab.label}
                  {tab.badge > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-3">
            {user.picture && (
              <img
                src={user.picture}
                alt={user.name}
                className="w-8 h-8 rounded-full border-2 border-white/50"
              />
            )}
            <span className="text-white text-sm font-medium hidden sm:block">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-white/80 hover:text-white text-sm border border-white/30 hover:border-white px-3 py-1 rounded-lg transition-colors"
            >
              Đăng xuất
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
