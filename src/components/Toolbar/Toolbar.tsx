import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { ChevronRight, ChevronLeft, ArrowUp, RotateCcw, Search, Grid3X3, List, LayoutList, PanelRight, Eye, EyeOff, Settings, TerminalSquare, Menu } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { ViewMode } from '../../types';
import { splitPath } from '../../utils/path';

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

function Breadcrumbs() {
  const { activeTab, navigate } = useApp();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const parts = React.useMemo(() => splitPath(activeTab.path), [activeTab.path]);

  const startEdit = () => {
    setEditValue(activeTab.path);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (editValue.trim()) navigate(editValue.trim());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="toolbar__address-input"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <div className="breadcrumbs" onClick={startEdit} title="Click to edit path">
      {parts.map((part, i) => (
        <React.Fragment key={part.path}>
          <button
            className="breadcrumbs__item"
            onClick={e => { e.stopPropagation(); navigate(part.path); }}
          >
            {part.name}
          </button>
          {i < parts.length - 1 && (
            <ChevronRight size={14} className="breadcrumbs__sep" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Search Bar ───────────────────────────────────────────────────────────────

function SearchBar() {
  const { state, dispatch } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_SEARCH_QUERY', query: e.target.value });
    dispatch({ type: 'SET_IS_SEARCHING', value: e.target.value.length > 0 });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
      dispatch({ type: 'SET_IS_SEARCHING', value: false });
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search-bar">
      <Search size={14} className="search-bar__icon" />
      <input
        ref={inputRef}
        id="search-input"
        className="search-bar__input"
        placeholder="Search files…"
        value={state.searchQuery}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

// ─── View Toggle ─────────────────────────────────────────────────────────────

function ViewToggle() {
  const { activeTab, dispatch } = useApp();
  const { viewMode } = activeTab;

  const set = (mode: ViewMode) => dispatch({ type: 'SET_VIEW_MODE', mode });

  return (
    <div className="view-toggle">
      <button className={`view-toggle__btn${viewMode === 'grid' ? ' view-toggle__btn--active' : ''}`} onClick={() => set('grid')} title="Grid view">
        <Grid3X3 size={16} />
      </button>
      <button className={`view-toggle__btn${viewMode === 'list' ? ' view-toggle__btn--active' : ''}`} onClick={() => set('list')} title="List view">
        <List size={16} />
      </button>
      <button className={`view-toggle__btn${viewMode === 'compact' ? ' view-toggle__btn--active' : ''}`} onClick={() => set('compact')} title="Compact view">
        <LayoutList size={16} />
      </button>
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarProps {
  onOpenSettings: () => void;
  onOpenTerminal: (path: string) => void;
}

export function Toolbar({ onOpenSettings, onOpenTerminal }: ToolbarProps) {
  const { state, dispatch, activeTab, navigateBack, navigateForward, navigateUp } = useApp();

  const canBack = activeTab.historyIndex > 0;
  const canForward = activeTab.historyIndex < activeTab.history.length - 1;
  const canUp = activeTab.path !== '/' && activeTab.path !== '__recent__';
  const currentName = activeTab.path.split('/').filter(Boolean).pop() || 'Home';

  if (state.platform.isMobile) {
    return (
      <>
        {/* ── Mobile Top Bar: Menu · Search · Settings ── */}
        <div className="toolbar toolbar--mobile-top">
          <button
            className="toolbar__btn"
            onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
            title="Menu"
            aria-label="Menu"
          >
            <Menu size={20} />
          </button>

          <SearchBar />

          <button
            className="toolbar__btn"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={18} />
          </button>
        </div>

        {/* ── Mobile Bottom Nav Bar: Back · Forward · Up · Name · Refresh ── */}
        <div className="toolbar toolbar--mobile-bottom">
          <button
            className="toolbar__btn"
            onClick={navigateBack}
            disabled={!canBack}
            title="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            className="toolbar__btn"
            onClick={navigateForward}
            disabled={!canForward}
            title="Forward"
          >
            <ChevronRight size={22} />
          </button>
          <button
            className="toolbar__btn"
            onClick={navigateUp}
            disabled={!canUp}
            title="Up"
          >
            <ArrowUp size={22} />
          </button>

          {/* Current folder name — centred, truncated */}
          <span className="toolbar__mobile-path" title={activeTab.path}>
            {currentName}
          </span>

          <button
            className="toolbar__btn"
            onClick={() => dispatch({ type: 'NAVIGATE', path: activeTab.path })}
            title="Refresh"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </>
    );
  }

  // ── Desktop layout (unchanged) ──────────────────────────────────────────────
  return (
    <div className="toolbar">
      <div className="toolbar__nav-btns">
        <button className="toolbar__btn" onClick={navigateBack} disabled={!canBack} title="Back (Alt+Left)">
          <ChevronLeft size={18} />
        </button>
        <button className="toolbar__btn" onClick={navigateForward} disabled={!canForward} title="Forward (Alt+Right)">
          <ChevronRight size={18} />
        </button>
        <button className="toolbar__btn" onClick={navigateUp} disabled={!canUp} title="Up (Alt+Up)">
          <ArrowUp size={18} />
        </button>
        <button className="toolbar__btn" onClick={() => dispatch({ type: 'NAVIGATE', path: activeTab.path })} title="Refresh (F5)">
          <RotateCcw size={16} />
        </button>
      </div>

      <Breadcrumbs />

      <div className="toolbar__right">
        <SearchBar />
        <div className="toolbar__divider" />
        <ViewToggle />
        <div className="toolbar__divider" />
        <button
          className={`toolbar__btn${state.previewVisible ? ' toolbar__btn--active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_PREVIEW' })}
          title="Toggle preview panel"
        >
          <PanelRight size={16} />
        </button>
        <button
          className="toolbar__btn"
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', settings: { showHiddenFiles: !state.settings.showHiddenFiles } })}
          title={state.settings.showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
        >
          {state.settings.showHiddenFiles ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button className="toolbar__btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <Settings size={16} />
        </button>
        {state.platform.supportsTerminal && (
          <button className="toolbar__btn" onClick={() => onOpenTerminal(activeTab.path)} title="Open terminal here" aria-label="Open terminal here">
            <TerminalSquare size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
