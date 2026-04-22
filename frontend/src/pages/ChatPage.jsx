import React, { useEffect, useRef, useState, useCallback } from 'react';
import Navbar from '../components/Navbar';
import ConversationList from '../components/chat/ConversationList';
import ChatView from '../components/chat/ChatView';
import CustomerPanel from '../components/chat/CustomerPanel';
import { chatApi } from '../utils/api';

const SESSIONS_POLL_MS = 5000;
const MESSAGES_POLL_MS = 3000;

const ChatPage = () => {
  const [sessions, setSessions]                     = useState([]);
  const [sessionsLoading, setSessionsLoading]       = useState(true);
  const [filter, setFilter]                         = useState(null);
  const [selectedSession, setSelectedSession]       = useState(null);
  const [messages, setMessages]                     = useState([]);
  const [order, setOrder]                           = useState(null);
  const [confirmationMessages, setConfirmationMsgs] = useState([]);
  const sessionsTimerRef = useRef(null);
  const messagesTimerRef = useRef(null);

  // ── Session polling ────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const res = await chatApi.getSessions();
      setSessions(res.data.sessions);
    } catch {
      // silent — keep stale data
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    sessionsTimerRef.current = setInterval(fetchSessions, SESSIONS_POLL_MS);
    return () => clearInterval(sessionsTimerRef.current);
  }, [fetchSessions]);

  // Keep selected session data in sync when sessions list refreshes
  useEffect(() => {
    if (!selectedSession) return;
    const updated = sessions.find((s) => s.id === selectedSession.id);
    if (updated) setSelectedSession(updated);
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Message polling ────────────────────────────────────────────────────────

  const fetchMessages = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await chatApi.getMessages(sessionId);
      setMessages(res.data.messages);
      setOrder(res.data.order);
      setConfirmationMsgs(res.data.confirmationMessages);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    clearInterval(messagesTimerRef.current);
    setMessages([]);
    setOrder(null);
    setConfirmationMsgs([]);

    if (!selectedSession) return;

    fetchMessages(selectedSession.id);
    messagesTimerRef.current = setInterval(
      () => fetchMessages(selectedSession.id),
      MESSAGES_POLL_MS
    );
    return () => clearInterval(messagesTimerRef.current);
  }, [selectedSession?.id, fetchMessages]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectSession = (s) => setSelectedSession(s);

  const handleAiModeToggle = async (newMode) => {
    if (!selectedSession) return;
    await chatApi.setAiMode(selectedSession.id, newMode);
    setSelectedSession((s) => ({ ...s, aiMode: newMode }));
    fetchSessions();
  };

  const handleIntentChange = (intent) => {
    setSelectedSession((s) => ({ ...s, intent }));
    fetchSessions();
  };

  const handleRefresh = () => {
    fetchSessions();
    if (selectedSession) fetchMessages(selectedSession.id);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <Navbar />

      <div className="flex flex-1 min-h-0">
        {/* Left: session list */}
        <ConversationList
          sessions={sessions}
          selectedId={selectedSession?.id}
          onSelect={handleSelectSession}
          filter={filter}
          onFilterChange={setFilter}
          loading={sessionsLoading}
        />

        {/* Middle: chat messages */}
        {selectedSession ? (
          <ChatView
            session={selectedSession}
            messages={messages}
            onAiModeToggle={handleAiModeToggle}
            onMessageSent={handleRefresh}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div>Chọn một hội thoại để bắt đầu</div>
            </div>
          </div>
        )}

        {/* Right: customer panel */}
        {selectedSession && (
          <CustomerPanel
            session={selectedSession}
            messages={messages}
            order={order}
            confirmationMessages={confirmationMessages}
            onIntentChange={handleIntentChange}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </div>
  );
};

export default ChatPage;
