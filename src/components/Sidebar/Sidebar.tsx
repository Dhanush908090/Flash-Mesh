import React from 'react';
import { useApp } from '../../store/AppContext';
import { SidebarNav } from './SidebarNav';
import { FileTree } from './FileTree';
import { FilterBox } from './FilterBox';
import { TaskPanel } from './TaskPanel';
import logoSrc from '/logo.png';

export function Sidebar() {
  const { state } = useApp();
  const collapsed = state.sidebarCollapsed;

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__logo">
        <div className="sidebar__logo-icon">
          <img src={logoSrc} alt="FlashMesh" className="sidebar__logo-img" />
        </div>
        {!collapsed && <span className="sidebar__logo-text">FlashMesh</span>}
      </div>
      <SidebarNav />
      {!collapsed && <FileTree />}
      {!collapsed && <FilterBox />}
      <TaskPanel />
    </aside>
  );
}
