import React from 'react';
import { Home, MessageCircle, Video, Users, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AppPage } from '../types';

export function Navigation() {
  const { state, setPage } = useApp();

  const navItems: Array<{ page: AppPage; icon: React.ComponentType<any>; label: string }> = [
    { page: 'home', icon: Home, label: 'Accueil' },
    { page: 'chat', icon: MessageCircle, label: 'Chat' },
    { page: 'video', icon: Video, label: 'Vidéo' },
    { page: 'groups', icon: Users, label: 'Groupes' },
    { page: 'settings', icon: Settings, label: 'Paramètres' },
  ];

  return (
    <nav className="bg-black/30 backdrop-blur-sm border-t border-white/10 p-3 flex-shrink-0 safe-area-bottom">
      <div className="flex justify-center space-x-8 max-w-md mx-auto">
        {navItems.map(({ page, icon: Icon, label }) => (
          <button
            key={page}
            onClick={() => setPage(page)}
            className={`flex flex-col items-center space-y-1 p-2 rounded-lg transition-all duration-300 min-w-[60px] ${
              state.currentPage === page
                ? 'text-cyan-400 bg-cyan-400/10'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="text-xs font-medium whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}