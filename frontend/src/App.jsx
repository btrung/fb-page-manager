import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PostsPage from './pages/PostsPage';
import IntelligencePage from './pages/IntelligencePage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import LoadingSpinner from './components/LoadingSpinner';

// Route chỉ dành cho user đã login
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  return user ? children : <Navigate to="/login" replace />;
};

// Route chỉ dành cho user chưa login
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  return user ? <Navigate to="/dashboard" replace /> : children;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/dashboard" replace />} />
    <Route
      path="/login"
      element={
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      }
    />
    <Route
      path="/dashboard"
      element={
        <PrivateRoute>
          <DashboardPage />
        </PrivateRoute>
      }
    />
    <Route
      path="/pages/:pageId/posts"
      element={
        <PrivateRoute>
          <PostsPage />
        </PrivateRoute>
      }
    />
    <Route
      path="/pages/:pageId/intelligence"
      element={
        <PrivateRoute>
          <IntelligencePage />
        </PrivateRoute>
      }
    />
    <Route
      path="/chat"
      element={
        <PrivateRoute>
          <ChatPage />
        </PrivateRoute>
      }
    />
    <Route
      path="/settings"
      element={
        <PrivateRoute>
          <SettingsPage />
        </PrivateRoute>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const App = () => (
  <AuthProvider>
    <AppRoutes />
  </AuthProvider>
);

export default App;
