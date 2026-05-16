import React from 'react';
import { useNavigate } from 'react-router-dom';

const CommentDetail = ({ comment }) => {
  const navigate = useNavigate();

  if (!comment) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Chọn comment để xem chi tiết
      </div>
    );
  }

  const journeySteps = [
    { icon: '📥', label: 'Đã vào inbox',      done: !!comment.inboxed },
    { icon: '💬', label: comment.chatCount ? `Đang chat (${comment.chatCount} tin)` : 'Chưa chat', done: !!comment.chatCount },
    { icon: '🛒', label: comment.ordered ? 'Đã đặt đơn' : 'Chưa đặt đơn', done: !!comment.ordered },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* Commenter */}
      <div>
        <div className="font-medium text-gray-800 text-sm">{comment.commenterName}</div>
        <div className="text-xs text-gray-400">{comment.timeAgo}</div>
      </div>

      {/* Comment content */}
      <div className="bg-gray-50 rounded-xl px-3 py-2 text-sm text-gray-700 border border-gray-100">
        "{comment.content}"
      </div>

      {/* AI reply */}
      {comment.aiReply && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">── AI Reply ──</div>
          <div className="bg-facebook-light rounded-xl px-3 py-2 text-xs text-gray-700 border border-blue-100">
            {comment.aiReply}
          </div>
        </div>
      )}

      {/* Journey */}
      <div>
        <div className="text-xs font-semibold text-gray-500 mb-2">── Hành trình ──</div>
        <div className="flex flex-col gap-1.5">
          {journeySteps.map((step, i) => (
            <div key={i} className={`flex items-center gap-2 text-xs ${step.done ? 'text-gray-700' : 'text-gray-400'}`}>
              <span>{step.icon}</span>
              <span>{step.label}</span>
              {step.done && <span className="text-green-500 ml-auto">✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Link to chat */}
      {comment.inboxed && (
        <button
          onClick={() => navigate('/chat')}
          className="mt-auto w-full text-xs bg-facebook-blue text-white py-2 rounded-xl hover:bg-facebook-dark transition-colors"
        >
          💬 Xem hội thoại →
        </button>
      )}
    </div>
  );
};

export default CommentDetail;
