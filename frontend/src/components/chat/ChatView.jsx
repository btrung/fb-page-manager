import React, { useEffect, useRef, useState } from 'react';
import { chatApi } from '../../utils/api';
import { getIntentMeta } from './intentUtils';

const Bubble = ({ msg }) => {
  const isCustomer = msg.senderType === 'customer';
  const isAi = msg.senderType === 'ai';

  const bubbleClass = isCustomer
    ? 'bg-gray-100 text-gray-800 self-start rounded-br-xl'
    : isAi
    ? 'bg-facebook-blue text-white self-end rounded-bl-xl'
    : 'bg-green-600 text-white self-end rounded-bl-xl';

  const label = isCustomer ? null : isAi ? '🤖 AI' : '👤 Bạn';

  const time = new Date(msg.createdAt);
  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  return (
    <div className={`flex flex-col max-w-[55%] ${isCustomer ? 'items-start' : 'items-end self-end ml-auto'}`}>
      {label && <span className="text-xs text-gray-400 mb-0.5 px-1">{label}</span>}
      <div className={`px-3 py-2 rounded-2xl text-base whitespace-pre-wrap break-words ${bubbleClass}`}>
        {msg.content}
        {msg.attachments?.filter((a) => a.type === 'image' && a.url).map((a, i) => (
          <img key={i} src={a.url} alt="attachment" className="mt-1 max-w-[200px] rounded-lg" />
        ))}
      </div>
      <span className="text-xs text-gray-300 mt-0.5 px-1">{timeStr}</span>
    </div>
  );
};

const ChatView = ({ session, messages, onAiModeToggle, onMessageSent }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      // Human override: auto-switch to HUMAN mode before sending
      if (session.aiMode === 'AI') {
        await onAiModeToggle('HUMAN');
      }
      await chatApi.sendMessage(session.id, content);
      setText('');
      onMessageSent?.();
    } catch {
      // silent
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isHuman = session.aiMode === 'HUMAN';
  const meta = getIntentMeta(session.intent);

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800 text-sm">
            {session.customerName || `PSID: ${session.customerPsid?.slice(-8)}`}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
            {meta.label}
          </span>
        </div>

        {/* AI Mode toggle */}
        <button
          onClick={() => onAiModeToggle(isHuman ? 'AI' : 'HUMAN')}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
            isHuman
              ? 'bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100'
              : 'bg-facebook-light text-facebook-blue border-blue-200 hover:bg-blue-100'
          }`}
        >
          {isHuman ? '👤 Người Tư Vấn' : '🤖 AI Hoạt Động'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">Chưa có tin nhắn</div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
        <div>
          {!isHuman && (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2 flex items-center gap-1.5">
              <span>🤖</span>
              <span>AI đang tự vấn. Gõ tin nhắn sẽ tự chuyển sang chế độ Người Tư Vấn.</span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nhập tin nhắn... (Enter để gửi)"
              rows={2}
              className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-facebook-blue"
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="bg-facebook-blue text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-facebook-dark disabled:opacity-40 transition-colors shrink-0"
            >
              {sending ? '...' : 'Gửi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatView;
