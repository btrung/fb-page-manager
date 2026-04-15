import React from 'react';
import { useNavigate } from 'react-router-dom';

const PageCard = ({ page }) => {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/pages/${page.id}/posts`)}
      className="card cursor-pointer hover:shadow-md hover:border-facebook-blue/30 transition-all duration-200 flex items-center gap-4"
    >
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
        </p>
      </div>

      {/* Arrow */}
      <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
};

export default PageCard;
