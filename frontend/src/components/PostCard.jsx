import React, { useState } from 'react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

const PostCard = ({ post, index }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = post.message.length > 200;
  const displayText = isLong && !expanded ? post.message.slice(0, 200) + '...' : post.message;

  return (
    <div className="card hover:shadow-md transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
        <span className="text-xs text-gray-400">
          {format(new Date(post.createdTime), 'dd/MM/yyyy HH:mm', { locale: vi })}
        </span>
      </div>

      {/* Ảnh */}
      {post.picture && (
        <div className="mb-3 rounded-lg overflow-hidden">
          <img
            src={post.picture}
            alt="Post media"
            className="w-full max-h-64 object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Nội dung text */}
      {post.message && (
        <div className="mb-3">
          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
            {displayText}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-facebook-blue text-xs mt-1 hover:underline"
            >
              {expanded ? 'Thu gọn' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-100 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
          </svg>
          {post.likes.toLocaleString('vi-VN')}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
          {post.comments.toLocaleString('vi-VN')}
        </span>
        {post.shares > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
            </svg>
            {post.shares.toLocaleString('vi-VN')}
          </span>
        )}

        {/* Link xem trên Facebook */}
        {post.permalink && (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-facebook-blue hover:underline flex items-center gap-1"
          >
            Xem trên Facebook
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
};

export default PostCard;
