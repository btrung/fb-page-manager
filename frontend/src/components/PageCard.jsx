import React from 'react';
import { useNavigate } from 'react-router-dom';

const PageCard = ({ page }) => {
  const navigate = useNavigate();

  return (
    <div className="card hover:shadow-md hover:border-facebook-blue/30 transition-all duration-200 flex items-center gap-4">
      {/* Avatar page */}
      <div className="flex-shrink-0">
        {page.picture ? (
          <img
            src={page.picture}
            alt={page.name}
            className="w-14 h-14 rounded-full object-cover border border-gray-200"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-facebook-light flex items-center justify-center">
            <svg className="w-7 h-7 text-facebook-blue" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm.75 13.5h-1.5v-5.25h1.5V15.5zm0-6.75h-1.5V7.25h1.5v1.5z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 truncate">{page.name}</h3>
        <p className="text-sm text-gray-500">{page.category}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {page.fanCount.toLocaleString('vi-VN')} người theo dõi
          {page.savedPostCount > 0 && ` · ${page.savedPostCount} posts trong DB`}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => navigate(`/pages/${page.id}/intelligence`)}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          🧠 Intelligence
        </button>
        <button
          onClick={() => navigate(`/pages/${page.id}/posts`)}
          className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Posts
        </button>
      </div>
    </div>
  );
};

export default PageCard;
