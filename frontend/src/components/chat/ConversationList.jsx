import React from 'react';
import { getIntentMeta, ALL_INTENTS, formatTime } from './intentUtils';

const ConversationList = ({ sessions, selectedId, onSelect, filter, onFilterChange, loading }) => {
  const filtered = filter
    ? sessions.filter((s) => s.intent === filter)
    : sessions;

  const dungCount = sessions.filter((s) => s.intent === 'Dừng').length;
  const chot = sessions.filter((s) => s.intent === 'Đang Chốt' || s.intent === 'Đã Chốt').length;

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white w-80 shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-800 text-sm">Hội thoại</h2>
          <div className="flex gap-1.5">
            {dungCount > 0 && (
              <span className="text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                {dungCount} Dừng
              </span>
            )}
            {chot > 0 && (
              <span className="text-xs bg-purple-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                {chot} Chốt
              </span>
            )}
          </div>
        </div>

        {/* Filter */}
        <select
          value={filter || ''}
          onChange={(e) => onFilterChange(e.target.value || null)}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 text-gray-700 focus:outline-none focus:ring-1 focus:ring-facebook-blue"
        >
          <option value="">Tất cả ({sessions.length})</option>
          {ALL_INTENTS.map((intent) => {
            const count = sessions.filter((s) => s.intent === intent).length;
            if (count === 0) return null;
            return (
              <option key={intent} value={intent}>
                {intent} ({count})
              </option>
            );
          })}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">Đang tải...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">Không có hội thoại nào</div>
        )}

        {filtered.map((s) => {
          const meta = getIntentMeta(s.intent);
          const isSelected = s.id === selectedId;

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors hover:bg-gray-50 ${
                isSelected ? 'bg-facebook-light border-l-2 border-l-facebook-blue' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Avatar placeholder */}
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-xs font-bold text-gray-500 mt-0.5">
                  {(s.customerName || s.customerPsid || '?')[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {s.customerName || `PSID: ${s.customerPsid?.slice(-6)}`}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatTime(s.lastMessageAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                    {s.aiMode === 'HUMAN' && (
                      <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded-full">
                        👤 Người
                      </span>
                    )}
                  </div>

                  {s.lastMessageContent && (
                    <p className="text-xs text-gray-400 mt-1 truncate">{s.lastMessageContent}</p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ConversationList;
