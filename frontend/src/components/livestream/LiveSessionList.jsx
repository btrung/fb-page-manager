import React from 'react';

const LiveSessionList = ({ sessions, selectedId, onSelect, onOpenSettings }) => (
  <div className="flex flex-col h-full">
    <div className="flex-1 overflow-y-auto">
      {sessions.map(s => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedId === s.id ? 'bg-facebook-light border-l-2 border-l-facebook-blue' : ''}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold ${s.isLive ? 'text-red-500' : 'text-gray-400'}`}>
              {s.isLive ? '🔴' : '✅'} Live {s.date}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>💬 {s.totalComments}</span>
            <span>🛍️ {s.intentCount}</span>
            <span>📥 {s.inboxCount}</span>
          </div>
        </button>
      ))}
    </div>

    <div className="p-3 border-t border-gray-100 shrink-0">
      <button
        onClick={onOpenSettings}
        className="w-full text-xs text-gray-500 hover:text-gray-700 py-2 rounded-lg hover:bg-gray-100 transition-colors"
      >
        ⚙️ Cài đặt AI
      </button>
    </div>
  </div>
);

export default LiveSessionList;
