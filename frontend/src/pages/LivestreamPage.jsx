import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import LiveSessionList from '../components/livestream/LiveSessionList';
import CommentFeed from '../components/livestream/CommentFeed';
import CommentDetail from '../components/livestream/CommentDetail';
import LiveSettingsModal from '../components/livestream/LiveSettingsModal';

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_SESSIONS = [
  {
    id: 's1',
    date: '16/5',
    isLive: true,
    totalComments: 47,
    intentCount: 12,
    inboxCount: 3,
    stats: { totalComments: 47, intentCount: 12, repliedCount: 11, inboxCount: 3, orderCount: 1 },
    comments: [
      {
        id: 'c1', commenterName: 'Nguyễn Văn A', timeAgo: '2m',
        content: 'áo đỏ size M giá bao nhiêu vậy shop ơi',
        aiReply: 'Chị nhắn vào page để em tư vấn ngay nhé! 👉 m.me/page?ref=live_ao-do',
        hasIntent: true, status: 'replied', inboxed: true, chatCount: 3, ordered: false,
      },
      {
        id: 'c2', commenterName: 'Trần Thị B', timeAgo: '5m',
        content: 'shop còn hàng không, muốn mua váy hoa',
        aiReply: 'Chị nhắn vào page để em tư vấn ngay nhé! 👉 m.me/page?ref=live_vay-hoa',
        hasIntent: true, status: 'replied', inboxed: false, chatCount: 0, ordered: false,
      },
      {
        id: 'c3', commenterName: 'Lê Văn C', timeAgo: '8m',
        content: 'bao nhiêu tiền 1 cái áo kia vậy',
        aiReply: 'Anh nhắn vào page để em báo giá nhé! 👉 m.me/page?ref=live_ao',
        hasIntent: true, status: 'replied', inboxed: true, chatCount: 5, ordered: true,
      },
      {
        id: 'c4', commenterName: 'Phạm Thị D', timeAgo: '12m',
        content: 'đẹp quá shop ơi 😍',
        aiReply: null,
        hasIntent: false, status: 'skipped', inboxed: false, chatCount: 0, ordered: false,
      },
      {
        id: 'c5', commenterName: 'Hoàng Văn E', timeAgo: '15m',
        content: 'set đồ này có bán lẻ từng cái không',
        aiReply: null,
        hasIntent: true, status: 'error', inboxed: false, chatCount: 0, ordered: false,
      },
      {
        id: 'c6', commenterName: 'Vũ Thị F', timeAgo: '18m',
        content: 'cho hỏi áo thun lạnh có size XL không',
        aiReply: 'Chị nhắn vào page để em kiểm tra size nhé! 👉 m.me/page?ref=live_ao-thun',
        hasIntent: true, status: 'replied', inboxed: false, chatCount: 0, ordered: false,
      },
    ],
  },
  {
    id: 's2',
    date: '14/5',
    isLive: false,
    totalComments: 23,
    intentCount: 8,
    inboxCount: 1,
    stats: { totalComments: 23, intentCount: 8, repliedCount: 8, inboxCount: 1, orderCount: 0 },
    comments: [
      {
        id: 'c7', commenterName: 'Đặng Văn G', timeAgo: '2 ngày',
        content: 'quần này có size 30 không shop',
        aiReply: 'Anh nhắn vào page để em tư vấn nhé! 👉 m.me/page?ref=live_quan',
        hasIntent: true, status: 'replied', inboxed: true, chatCount: 2, ordered: false,
      },
      {
        id: 'c8', commenterName: 'Bùi Thị H', timeAgo: '2 ngày',
        content: 'giá áo khoác sweater bao nhiêu',
        aiReply: 'Chị nhắn vào page để em báo giá ngay nhé! 👉 m.me/page?ref=live_ao-khoac',
        hasIntent: true, status: 'replied', inboxed: false, chatCount: 0, ordered: false,
      },
    ],
  },
  {
    id: 's3',
    date: '12/5',
    isLive: false,
    totalComments: 31,
    intentCount: 5,
    inboxCount: 2,
    stats: { totalComments: 31, intentCount: 5, repliedCount: 5, inboxCount: 2, orderCount: 1 },
    comments: [],
  },
];

const MOCK_SETTINGS = { aiEnabled: true, ctaText: '{tên} nhắn vào page để em tư vấn ngay nhé! 👉 {link}' };

// ── Page ──────────────────────────────────────────────────────────────────────

const LivestreamPage = () => {
  const [selectedSessionId, setSelectedSessionId] = useState(MOCK_SESSIONS[0].id);
  const [selectedCommentId, setSelectedCommentId] = useState(null);
  const [showSettings, setShowSettings]           = useState(false);
  const [settings, setSettings]                   = useState(MOCK_SETTINGS);

  const selectedSession = MOCK_SESSIONS.find(s => s.id === selectedSessionId) || null;
  const selectedComment = selectedSession?.comments.find(c => c.id === selectedCommentId) || null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <Navbar />

      {/* Sub-header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="font-semibold text-gray-700 text-sm">📺 Livestream</span>
        <select className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-facebook-blue">
          <option>Cửa hàng ABC</option>
        </select>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Session list */}
        <div className="w-48 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phiên Live</span>
          </div>
          <LiveSessionList
            sessions={MOCK_SESSIONS}
            selectedId={selectedSessionId}
            onSelect={(id) => { setSelectedSessionId(id); setSelectedCommentId(null); }}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>

        {/* Middle — Comment feed */}
        <div className="flex-1 border-r border-gray-200 bg-white flex flex-col overflow-hidden min-w-0">
          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Comments</span>
          </div>
          <CommentFeed
            session={selectedSession}
            selectedCommentId={selectedCommentId}
            onSelectComment={setSelectedCommentId}
          />
        </div>

        {/* Right — Detail */}
        <div className="w-72 shrink-0 bg-white flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Detail</span>
          </div>
          <CommentDetail comment={selectedComment} />
        </div>

      </div>

      <LiveSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={(s) => setSettings(s)}
      />
    </div>
  );
};

export default LivestreamPage;
