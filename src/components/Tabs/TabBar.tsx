import React, { useState, useRef } from 'react';
import { useApp } from '../../store/AppContext';
import { X, Plus } from 'lucide-react';
import { getBaseName } from '../../utils/path';

export function TabBar() {
  const { state, dispatch } = useApp();
  const { tabs, activeTabId } = state;
  const dragSrc = useRef<number | null>(null);

  function handleDragStart(idx: number) {
    dragSrc.current = idx;
  }

  function handleDrop(idx: number) {
    if (dragSrc.current === null || dragSrc.current === idx) return;
    dispatch({ type: 'REORDER_TABS', fromIndex: dragSrc.current, toIndex: idx });
    dragSrc.current = null;
  }

  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.map((tab, idx) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeTabId ? ' tab--active' : ''}`}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
            onClick={() => dispatch({ type: 'SWITCH_TAB', id: tab.id })}
            onAuxClick={e => { if (e.button === 1) dispatch({ type: 'CLOSE_TAB', id: tab.id }); }}
            title={tab.path}
          >
            <span className="tab__folder-icon">▣</span>
            <span className="tab__label">{getBaseName(tab.path)}</span>
            <button
              className="tab__close"
              onClick={e => {
                e.stopPropagation();
                dispatch({ type: 'CLOSE_TAB', id: tab.id });
              }}
              title="Close tab"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="tab-bar__new-tab"
          onClick={() => dispatch({ type: 'NEW_TAB' })}
          title="New tab (Ctrl+T)"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
