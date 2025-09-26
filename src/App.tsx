import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { HomePage } from './components/HomePage';
import { ChatPage } from './components/ChatPage';
import { VideoCallPage } from './components/VideoCallPage';
import { GroupsPage } from './components/GroupsPage';
import { SettingsPage } from './components/SettingsPage';
import { Navigation } from './components/Navigation';

function AppContent() {
  const { state } = useApp();

  const renderCurrentPage = () => {
    switch (state.currentPage) {
      case 'home':
        return <HomePage />;
      case 'chat':
        return <ChatPage />;
      case 'video':
        return <VideoCallPage />;
      case 'groups':
        return <GroupsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="flex-1 overflow-hidden">
        {renderCurrentPage()}
      </div>
      {state.currentPage !== 'home' && <Navigation />}
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;