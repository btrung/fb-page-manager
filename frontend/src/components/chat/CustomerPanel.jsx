import React, { useState } from 'react';
import { chatApi } from '../../utils/api';
import { getIntentMeta, ALL_INTENTS, formatTs } from './intentUtils';

// ── Tab 1: Thông tin khách ──────────────────────────────────────────────────

const InfoTab = ({ session, confirmationMessages, onIntentChange, onTagAdd, onTagRemove, onRefresh }) => {
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [changingIntent, setChangingIntent] = useState(false);

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    setAddingTag(true);
    try {
      await chatApi.addTag(session.id, newTag.trim());
      setNewTag('');
      onRefresh();
    } finally {
      setAddingTag(false);
    }
  };

  const handleRemoveTag = async (tag) => {
    await chatApi.removeTag(session.id, tag);
    onRefresh();
  };

  const handleIntentChange = async (intent) => {
    setChangingIntent(true);
    try {
      await chatApi.setIntent(session.id, intent);
      onIntentChange(intent);
    } finally {
      setChangingIntent(false);
    }
  };

  const meta = getIntentMeta(session.intent);

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {/* Khách info */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
        <div className="flex gap-2">
          <span className="text-gray-400 w-12 shrink-0">Tên:</span>
          <span className="text-gray-800 font-medium">{session.customerName || '—'}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-400 w-12 shrink-0">PSID:</span>
          <span className="text-gray-600 font-mono text-xs break-all">{session.customerPsid}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-400 w-12 shrink-0">Page:</span>
          <span className="text-gray-600 text-xs">{session.pageId}</span>
        </div>
      </div>

      {/* Intent */}
      <div>
        <div className="text-xs text-gray-500 font-medium mb-1.5">Intent</div>
        <select
          value={session.intent}
          onChange={(e) => handleIntentChange(e.target.value)}
          disabled={changingIntent}
          className={`w-full text-xs border rounded-lg px-2 py-1.5 font-medium focus:outline-none focus:ring-1 focus:ring-facebook-blue ${meta.color}`}
        >
          {ALL_INTENTS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      {/* AI Turn count + Mood */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
          <span className="text-gray-500 text-xs">AI replies</span>
          <span className="text-gray-700 font-semibold text-sm">{session.aiTurnCount ?? 0} / 10</span>
        </div>
        {session.customerMood && session.customerMood !== 'neutral' && (
          <div className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium shrink-0 ${
            session.customerMood === 'positive' ? 'bg-green-50 text-green-700' :
            session.customerMood === 'negative' ? 'bg-red-50 text-red-600' :
            session.customerMood === 'urgent'   ? 'bg-orange-50 text-orange-600' :
            'bg-gray-50 text-gray-500'
          }`}>
            {session.customerMood === 'positive' ? '😊' :
             session.customerMood === 'negative' ? '😤' :
             session.customerMood === 'urgent'   ? '⚡' : '😐'}
            {session.customerMood}
          </div>
        )}
      </div>

      {/* Identified Product */}
      {session.identifiedProduct && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <div className="text-xs text-blue-500 font-medium mb-1">🎯 Sản phẩm quan tâm</div>
          <div className="text-sm text-blue-800 font-medium">{session.identifiedProduct.name}</div>
          {session.identifiedProduct.query && session.identifiedProduct.query !== session.identifiedProduct.name && (
            <div className="text-xs text-blue-400 mt-0.5">query: {session.identifiedProduct.query}</div>
          )}
        </div>
      )}

      {/* Tags */}
      <div>
        <div className="text-xs text-gray-500 font-medium mb-1.5">Tags</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(session.tags ?? []).map((tag) => (
            <span key={tag} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full">
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="hover:text-red-500 transition-colors text-gray-400 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          {(session.tags ?? []).length === 0 && (
            <span className="text-gray-400 text-xs">Chưa có tag</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            placeholder="Thêm tag..."
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-facebook-blue"
          />
          <button
            onClick={handleAddTag}
            disabled={addingTag || !newTag.trim()}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs px-2.5 py-1 rounded-lg disabled:opacity-40 transition-colors"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Tab 2: Đã Chốt ─────────────────────────────────────────────────────────

const ChotTab = ({ order, confirmationMessages, onOrderAction, onRefresh }) => {
  const [acting, setActing] = useState(false);

  const handleAction = async (status) => {
    setActing(true);
    try {
      await chatApi.updateOrder(order.id, status);
      onRefresh();
    } finally {
      setActing(false);
    }
  };

  const handleCopy = () => {
    const text = [
      `📦 ${order.productName || '?'}`,
      `👤 ${order.customerName || '?'}`,
      `📞 ${order.phone || '?'}`,
      `📍 ${order.address || '?'}`,
    ].join('\n');
    navigator.clipboard.writeText(text);
  };

  if (!order) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm py-12">
        Chưa có đơn hàng
      </div>
    );
  }

  const summaryMsg = confirmationMessages?.find((m) => m.isConfirmationSummary);
  const confirmedMsg = confirmationMessages?.find((m) => m.isCustomerConfirmed);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm overflow-y-auto">
      {/* Status header */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
        <div className="text-purple-700 font-bold text-sm">🟣 AI ĐÃ CHỐT ĐƠN</div>
        {order.customerConfirmedAt && (
          <div className="text-purple-500 text-xs mt-0.5">
            Chốt lúc: {formatTs(order.customerConfirmedAt)}
          </div>
        )}
      </div>

      {/* Order info */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
        <div className="text-xs text-gray-500 font-medium mb-2">📋 THÔNG TIN ĐƠN</div>
        {[
          ['📦 SP',  order.productName],
          ['👤 Tên', order.customerName],
          ['📞 SĐT', order.phone],
          ['📍 Địa', order.address],
        ].map(([label, value]) => (
          <div key={label} className="flex gap-2 text-xs">
            <span className="text-gray-400 w-14 shrink-0">{label}:</span>
            <span className="text-gray-800">{value || '—'}</span>
          </div>
        ))}
      </div>

      {/* Evidence */}
      <div>
        <div className="text-xs text-gray-500 font-medium mb-2">✅ BẰNG CHỨNG XÁC NHẬN</div>

        {summaryMsg && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2">
            <div className="text-xs text-blue-500 font-medium mb-1">
              🤖 AI — {formatTs(summaryMsg.createdAt)}
            </div>
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{summaryMsg.content}</p>
          </div>
        )}

        {confirmedMsg && (
          <div className="bg-green-50 border-2 border-green-400 rounded-xl p-3 mb-1">
            <div className="text-xs text-green-600 font-medium mb-1">
              👤 Khách — {formatTs(confirmedMsg.createdAt)}
            </div>
            <p className="text-xs text-gray-800 font-medium">"{confirmedMsg.content}"</p>
          </div>
        )}

        {order.customerConfirmedAt && (
          <div className="text-xs text-gray-400 text-right">
            ⏱ Xác nhận: {formatTs(order.customerConfirmedAt)}
          </div>
        )}
      </div>

      {/* Actions */}
      {order.status === 'PENDING_REVIEW' && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => handleAction('CONFIRMED')}
            disabled={acting}
            className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 rounded-xl disabled:opacity-40 transition-colors"
          >
            ✅ Xác nhận gửi hàng
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm py-1.5 rounded-xl transition-colors"
            >
              📋 Copy đơn
            </button>
            <button
              onClick={() => handleAction('CANCELLED')}
              disabled={acting}
              className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-sm py-1.5 rounded-xl disabled:opacity-40 transition-colors"
            >
              ❌ Huỷ đơn
            </button>
          </div>
        </div>
      )}

      {order.status === 'CONFIRMED' && (
        <div className="text-center text-green-600 text-sm font-medium bg-green-50 rounded-xl py-2">
          ✅ Đã xác nhận gửi hàng
        </div>
      )}
      {order.status === 'CANCELLED' && (
        <div className="text-center text-red-500 text-sm bg-red-50 rounded-xl py-2">
          ❌ Đã huỷ đơn
        </div>
      )}
    </div>
  );
};

// ── Main CustomerPanel ──────────────────────────────────────────────────────

const CustomerPanel = ({ session, messages, order, confirmationMessages, onIntentChange, onRefresh }) => {
  const hasOrder = !!order;
  const defaultTab = hasOrder ? 'chot' : 'info';
  const [tab, setTab] = useState(defaultTab);

  // Switch default tab when session changes
  React.useEffect(() => {
    setTab(hasOrder ? 'chot' : 'info');
  }, [session?.id, hasOrder]);

  const tabClass = (t) =>
    `flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
      tab === t
        ? 'border-facebook-blue text-facebook-blue'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="flex flex-col w-80 shrink-0 border-l border-gray-200 bg-white h-full">
      {/* Tab header */}
      <div className="flex border-b border-gray-100 shrink-0">
        <button className={tabClass('info')} onClick={() => setTab('info')}>
          👤 Thông tin khách
        </button>
        <button
          className={tabClass('chot')}
          onClick={() => setTab('chot')}
        >
          {hasOrder ? '🟣 Đã Chốt' : '📦 Đơn hàng'}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'info' ? (
          <InfoTab
            session={session}
            confirmationMessages={confirmationMessages}
            onIntentChange={onIntentChange}
            onTagAdd={() => {}}
            onTagRemove={() => {}}
            onRefresh={onRefresh}
          />
        ) : (
          <ChotTab
            order={order}
            confirmationMessages={confirmationMessages}
            onOrderAction={() => {}}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
};

export default CustomerPanel;
