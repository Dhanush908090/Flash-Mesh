import React from 'react';
import { Files, Cloud, Zap } from 'lucide-react';
import { useApp } from '../../store/AppContext';

export function MobileNav() {
  const { state, dispatch } = useApp();
  const { currentView } = state;

  if (!state.platform.isMobile) return null;

  const tabs = [
    { id: 'files', label: 'Files', icon: <Files size={20} /> },
    { id: 'cloud', label: 'Cloud', icon: <Cloud size={20} /> },
    { id: 'pet', label: 'Pet AI', icon: <Zap size={20} /> },
  ] as const;

  const activeIndex = tabs.findIndex(t => t.id === currentView);

  return (
    <nav className="mobile-nav">
      <div 
        className="mobile-nav__indicator" 
        style={{ 
          transform: `translateX(${(activeIndex - 1) * 100}%)`, 
          left: 'calc(50% - 20px)'
        }} 
      />
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`mobile-nav__item${currentView === tab.id ? ' mobile-nav__item--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW', view: tab.id })}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
