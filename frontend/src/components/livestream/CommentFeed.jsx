import React, { useState } from 'react';

const FILTERS = [
  { key: 'all',    label: 'Tất cả' },
  { key: 'intent', label: '🛍️ Intent' },
  { key: 'inbox',  label: '📥 Đã inbox' },
  { key: 'error',  label: '⚠️ Lỗi' },
];

const statusBadge = (comment) => {
  if (comment.status === 'processing') return <span className="text-xs text-yellow-600">⏳ Đang xử lý</span>;
  if (comment.status === 'error')      return <span className="text-xs text-red-500">⚠️ Lỗi reply</span>;
  if (comment.status === 'replied')    return <span className="text-xs text-green-600">✅ Đã reply</span>;
  return null;
};

const inboxBadge = (comment) => {
  if (!comment.hasIntent) return null;
  return comment.inboxed
    ? <span className="text-xs text-facebook-blue">📥 Đã inbox</span>
    : <span className="text-xs text-gray-400">🚫 Chưa inbox</span>;
};

const CommentFeed = ({ session, selectedCommentId, onSelectComment }) => {
  const [activeFilter, setActiveFilter] = useState('intent');

  if (!session) {
    return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Chọn phiên live</div>;
  }

  const { comments, stats } = session;

  const filtered = comments.filter(c => {
    if (activeFilter === 'all')    return true;
    if (activeFilter === 'intent') return c.hasIntent;
    if (activeFilter === 'inbox')  return c.inboxed;
    if (activeFilter === 'error')  return c.status === 'error';
    return true;
  });

  const intentPct = stats.totalComments > 0 ? Math.round(stats.intentCount / stats.totalComments * 100) : 0;
  const errorCount = comments.filter(c => c.status === 'error').length;

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-gray-100 shrink-0 flex-wrap">
        {FILTERS.map(f => {
          if (f.key === 'error' && errorCount === 0) return null;
          const count = f.key === 'all' ? comments.length
            : f.key === 'intent' ? stats.intentCount
            : f.key === 'inbox'  ? stats.inboxCount
            : errorCount;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                activeFilter === f.key
                  ? 'bg-facebook-blue text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label} {count}
            </button>
          );
        })}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 shrink-0 flex-wrap">
        <span>💬 {stats.totalComments}</span>
        <span className="text-gray-300">|</span>
        <span>🛍️ {stats.intentCount} ({intentPct}%)</span>
        <span className="text-gray-300">|</span>
        <span>✅ {stats.repliedCount}/{stats.intentCount} đã reply</span>
        <span className="text-gray-300">|</span>
        <span>📥 {stats.inboxCount}</span>
        <span className="text-gray-300">|</span>
        <span>🛒 {stats.orderCount} đơn</span>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm">Không có comment</div>
        )}
        {filtered.map(c => (
          <button
            key={c.id}
            onClick={() => onSelectComment(c.id)}
            className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedCommentId === c.id ? 'bg-facebook-light border-l-2 border-l-facebook-blue' : ''}`}
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium text-gray-700">{c.commenterName}</span>
              <span className="text-xs text-gray-400">{c.timeAgo}</span>
            </div>
            <div className="text-xs text-gray-600 truncate mb-1.5">{c.content}</div>

            {/* AI reply preview */}
            {c.aiReply && (
              <div className={`text-xs rounded-lg px-2 py-1.5 mb-1.5 border ${activeFilter === 'intent' || activeFilter === 'inbox' ? 'text-gray-600 bg-blue-50 border-blue-100 line-clamp-2' : 'text-gray-400 bg-gray-50 border-gray-100 truncate'}`}>
                {activeFilter === 'all' ? `↳ ${c.aiReply.slice(0, 60)}…` : c.aiReply}
              </div>
            )}

            <div className="flex items-center gap-2">
              {statusBadge(c)}
              {inboxBadge(c)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CommentFeed;
