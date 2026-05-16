import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { chatApi } from '../utils/api';

const ChatBadgeContext = createContext({ dungCount: 0, chotCount: 0 });

export const ChatBadgeProvider = ({ children }) => {
  const { user } = useAuth();
  const [dungCount, setDungCount] = useState(0);
  const [chotCount, setChotCount] = useState(0);
  const timerRef = useRef(null);

  const fetchCounts = async () => {
    try {
      const res = await chatApi.getSessions();
      const sessions = res.data.sessions ?? [];
      setDungCount(sessions.filter((s) => s.intent === 'Dừng').length);
      setChotCount(sessions.filter((s) => s.intent === 'Đang Chốt' || s.intent === 'Đã Chốt').length);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (!user) {
      setDungCount(0);
      setChotCount(0);
      return;
    }
    fetchCounts();
    timerRef.current = setInterval(fetchCounts, 15000);
    return () => clearInterval(timerRef.current);
  }, [user]);

  return (
    <ChatBadgeContext.Provider value={{ dungCount, chotCount }}>
      {children}
    </ChatBadgeContext.Provider>
  );
};

export const useChatBadge = () => useContext(ChatBadgeContext);
