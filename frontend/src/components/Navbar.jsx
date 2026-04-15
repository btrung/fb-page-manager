import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="bg-facebook-blue shadow-md">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/dashboard" className="text-white font-bold text-lg tracking-tight">
          FB Page Manager
        </Link>

        {user && (
          <div className="flex items-center gap-3">
            {user.picture && (
              <img
                src={user.picture}
                alt={user.name}
                className="w-8 h-8 rounded-full border-2 border-white/50"
              />
            )}
            <span className="text-white text-sm font-medium hidden sm:block">
              {user.name}
            </span>
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
