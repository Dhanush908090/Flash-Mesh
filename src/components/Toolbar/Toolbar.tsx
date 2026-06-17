import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ChevronRight, ChevronLeft, ArrowUp, RotateCcw, Search, Grid3X3, List, LayoutList, PanelRight, Eye, EyeOff, Settings, TerminalSquare, Menu, X } from 'lucide-react';
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

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
};

function parseSearchQuery(query: string) {
  let cleanQuery = query;
  const extractedTypes: string[] = [];
  const extractedMonths: string[] = [];

  // Parse type modifiers: type:image, type:video, type:doc, type:code, type:other
  const typeRegex = /\btype:(\w+)\b/gi;
  let match;
  while ((match = typeRegex.exec(query)) !== null) {
    const val = match[1].toLowerCase();
    if (['image', 'img', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(val)) extractedTypes.push('image');
    else if (['video', 'mp4', 'mov', 'avi', 'mkv'].includes(val)) extractedTypes.push('video');
    else if (['audio', 'mp3', 'wav', 'flac'].includes(val)) extractedTypes.push('audio');
    else if (['doc', 'document', 'pdf', 'txt', 'md'].includes(val)) extractedTypes.push('document');
    else if (['code', 'src', 'js', 'ts', 'py', 'rs', 'go'].includes(val)) extractedTypes.push('code');
    else if (['other', 'misc'].includes(val)) extractedTypes.push('other');
    cleanQuery = cleanQuery.replace(match[0], '');
  }

  // Parse month names: jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec
  const monthMap: Record<string, string> = {
    january: '01', jan: '01',
    february: '02', feb: '02',
    march: '03', mar: '03',
    april: '04', apr: '04',
    may: '05',
    june: '06', jun: '06',
    july: '07', jul: '07',
    august: '08', aug: '08',
    september: '09', sep: '09',
    october: '10', oct: '10',
    november: '11', nov: '11',
    december: '12', dec: '12',
  };

  for (const [key, val] of Object.entries(monthMap)) {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    if (regex.test(cleanQuery)) {
      extractedMonths.push(val);
      cleanQuery = cleanQuery.replace(regex, '');
    }
  }

  // Parse explicit date formats: e.g. YYYY-MM
  const dateRegex = /\b(19|20)\d{2}[-/](0[1-9]|1[0-2])\b/g;
  while ((match = dateRegex.exec(query)) !== null) {
    extractedMonths.push(match[2]);
    cleanQuery = cleanQuery.replace(match[0], '');
  }

  return {
    cleanQuery: cleanQuery.replace(/\s+/g, ' ').trim(),
    extractedTypes,
    extractedMonths,
  };
}

function SearchBar() {
  const { state, dispatch } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Sync internal input value with global search query when it changes externally
  useEffect(() => {
    setInputValue(state.searchQuery);
  }, [state.searchQuery]);

  const runParser = (val: string) => {
    const parsed = parseSearchQuery(val);
    
    // Dispatch any new filters found
    parsed.extractedTypes.forEach(t => {
      if (!state.filters.types.includes(t)) {
        dispatch({ type: 'TOGGLE_FILTER_TYPE', fileType: t });
      }
    });

    parsed.extractedMonths.forEach(m => {
      if (!state.filters.months.includes(m)) {
        dispatch({ type: 'TOGGLE_FILTER_MONTH', month: m });
      }
    });

    // Update state query and value if filters were extracted
    if (parsed.extractedTypes.length > 0 || parsed.extractedMonths.length > 0) {
      setInputValue(parsed.cleanQuery);
      dispatch({ type: 'SET_SEARCH_QUERY', query: parsed.cleanQuery });
      dispatch({ type: 'SET_IS_SEARCHING', value: parsed.cleanQuery.length > 0 || state.filters.months.length > 0 || state.filters.types.length > 0 });
    } else {
      dispatch({ type: 'SET_SEARCH_QUERY', query: val });
      dispatch({ type: 'SET_IS_SEARCHING', value: val.length > 0 || state.filters.months.length > 0 || state.filters.types.length > 0 });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // If typing space, run the parser immediately
    if (val.endsWith(' ')) {
      runParser(val);
    } else {
      dispatch({ type: 'SET_SEARCH_QUERY', query: val });
      dispatch({ type: 'SET_IS_SEARCHING', value: val.length > 0 || state.filters.months.length > 0 || state.filters.types.length > 0 });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
      dispatch({ type: 'SET_IS_SEARCHING', value: false });
      dispatch({ type: 'CLEAR_FILTERS' });
      setInputValue('');
      inputRef.current?.blur();
    }
    if (e.key === 'Enter') {
      runParser(inputValue);
    }
  };

  const cycleSearchLevel = () => {
    const nextLevel = state.searchLevel === 3 ? 1 : state.searchLevel + 1;
    dispatch({ type: 'SET_SEARCH_LEVEL', level: nextLevel });
  };

  const levelLabels: Record<number, string> = {
    1: 'L1: Filename Match',
    2: 'L2: Text Content Scan',
    3: 'L3: Deep Binary Scan'
  };

  return (
    <div className="search-bar-container">
      <div className="search-bar">
        <Search size={14} className="search-bar__icon" />
        
        {/* Render active filters as pills inside the search box */}
        <div className="search-bar__pills">
          {state.filters.types.map(t => (
            <span key={t} className="search-pill">
              <span>{t}</span>
              <button 
                className="search-pill__close"
                onClick={() => dispatch({ type: 'TOGGLE_FILTER_TYPE', fileType: t })}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {state.filters.months.map(m => (
            <span key={m} className="search-pill">
              <span>{MONTH_LABELS[m] || m}</span>
              <button 
                className="search-pill__close"
                onClick={() => dispatch({ type: 'TOGGLE_FILTER_MONTH', month: m })}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>

        <input
          ref={inputRef}
          id="search-input"
          className="search-bar__input"
          placeholder={state.filters.types.length > 0 || state.filters.months.length > 0 ? "" : "Search files…"}
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />

        {/* Level selector button */}
        <button 
          className={`search-level-btn search-level-btn--${state.searchLevel}`}
          onClick={cycleSearchLevel}
          title={levelLabels[state.searchLevel]}
        >
          L{state.searchLevel}
        </button>
      </div>
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
