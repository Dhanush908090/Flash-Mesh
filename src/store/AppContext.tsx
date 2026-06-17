import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type {
  TabState, ViewMode, SortConfig, ClipboardState,
  AppSettings, DialogType, ContextMenuState, FileEntry, FileOperation,
  PlatformCapabilities, Task, FileFilters
} from '../types';
import { getBaseName, getParentPath, normalizePath } from '../utils/path';

const SETTINGS_KEY = 'flashmesh.settings.v1';
const SESSION_KEY = 'flashmesh.session.v1';

const DEFAULT_SETTINGS: AppSettings = {
  defaultView: 'grid',
  showHiddenFiles: false,
  showFileExtensions: true,
  theme: 'dark',
  confirmBeforeDelete: true,
  startupFolder: '',
  sidebarWidth: 240,
  pinnedPaths: [],
  hoverOpenItems: false,
  hoverOpenDelay: 2000,
  recentHistoryLimit: 20,
  recentHistory: [],
  iconPackage: 'rounded',
  autoErrorReporting: true,
  userEmail: 't.dhanushit@gmail.com',
  dragDropAction: 'ask',
  omnitrixMenu: false,
  turboMode: true,
  concurrencyLimit: 16,
  chunkSizeRange: '1-3mb',
  encryptionStrategy: 'adaptive',
};

export const DEFAULT_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  os: 'unknown',
  family: 'unknown',
  isMobile: false,
  supportsDrives: true,
  supportsTrash: true,
  supportsTerminal: true,
  supportsOpenWith: true,
  filesystemScope: 'native-filesystem',
};

interface SerializableTab {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  label: string;
  scrollPosition: number;
  selection: string[];
  viewMode: ViewMode;
  sortConfig: SortConfig;
  lastUpdated: number;
}

interface SerializableSession {
  tabs: SerializableTab[];
  activeTabId: string;
}

const createTab = (path: string, viewMode: ViewMode, id?: string): TabState => ({
  id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
  path,
  history: [path],
  historyIndex: 0,
  label: getBaseName(path),
  scrollPosition: 0,
  selection: new Set(),
  viewMode,
  sortConfig: { field: 'name', direction: 'asc' },
  selectionPivot: null as string | null,
  lastUpdated: Date.now(),
});

interface AppState {
  tabs: TabState[];
  activeTabId: string;
  clipboard: ClipboardState;
  settings: AppSettings;
  dialog: DialogType;
  contextMenu: ContextMenuState;
  undoStack: FileOperation[];
  redoStack: FileOperation[];
  sidebarCollapsed: boolean;
  previewVisible: boolean;
  searchQuery: string;
  isSearching: boolean;
  platform: PlatformCapabilities;
  currentView: 'files' | 'cloud' | 'pet' | 'pool';
  tasks: Task[];
  filters: FileFilters;
  searchLevel: number;
}

type Action =
  | { type: 'NAVIGATE'; path: string }
  | { type: 'RELOAD' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }
  | { type: 'NAVIGATE_UP' }
  | { type: 'NEW_TAB'; path?: string }
  | { type: 'CLOSE_TAB'; id: string }
  | { type: 'SWITCH_TAB'; id: string }
  | { type: 'REORDER_TABS'; fromIndex: number; toIndex: number }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SET_SORT'; config: SortConfig }
  | { type: 'SET_SELECTION'; ids: Set<string> }
  | { type: 'TOGGLE_SELECTION'; id: string }
  | { type: 'SET_SELECTION_RANGE'; ids: Set<string> }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_CLIPBOARD'; items: FileEntry[]; operation: 'copy' | 'cut'; sourceProvider?: 'local' | 'google' | 'dropbox' | 'pool' }
  | { type: 'CLEAR_CLIPBOARD' }
  | { type: 'SET_DIALOG'; dialog: DialogType }
  | { type: 'SET_CONTEXT_MENU'; menu: ContextMenuState }
  | { type: 'HIDE_CONTEXT_MENU' }
  | { type: 'PUSH_UNDO'; op: FileOperation }
  | { type: 'POP_UNDO' }
  | { type: 'POP_REDO' }
  | { type: 'CLEAR_REDO' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; value: boolean }
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_IS_SEARCHING'; value: boolean }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<AppSettings> }
  | { type: 'SET_TAB_SCROLL'; position: number }
  | { type: 'RECORD_RECENT'; path: string }
  | { type: 'CLEAR_RECENT' }
  | { type: 'SET_PLATFORM'; platform: PlatformCapabilities }
  | { type: 'SET_VIEW'; view: 'files' | 'cloud' | 'pet' | 'pool' }
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'UPDATE_TASK'; id: string; updates: Partial<Task> }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'TOGGLE_FILTER_MONTH'; month: string }
  | { type: 'TOGGLE_FILTER_TYPE'; fileType: string }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'SET_SEARCH_LEVEL'; level: number };

function reducer(state: AppState, action: Action): AppState {
  const activeTab = state.tabs.find(t => t.id === state.activeTabId)!;
  const updateActiveTab = (updates: Partial<TabState>): AppState => ({
    ...state,
    tabs: state.tabs.map(t => t.id === state.activeTabId ? { ...t, ...updates } : t),
  });

  switch (action.type) {
    case 'NAVIGATE': {
      if (!action.path.trim()) return state;
      const normalized = normalizePath(action.path);
      const newHistory = activeTab.history.slice(0, activeTab.historyIndex + 1);
      newHistory.push(normalized);
      
      let newRecent = state.settings.recentHistory;
      if (normalized !== '__recent__') {
        newRecent = [normalized, ...state.settings.recentHistory.filter(p => p !== normalized)].slice(0, state.settings.recentHistoryLimit);
      }

      return {
        ...updateActiveTab({
          path: normalized,
          history: newHistory,
          historyIndex: newHistory.length - 1,
          label: getBaseName(normalized),
          selection: new Set(),
          selectionPivot: null,
          scrollPosition: 0,
        }),
        settings: { ...state.settings, recentHistory: newRecent }
      };
    }
    case 'RELOAD':
      return updateActiveTab({ lastUpdated: Date.now() });
    case 'NAVIGATE_BACK': {
      if (activeTab.historyIndex <= 0) return state;
      const newIndex = activeTab.historyIndex - 1;
      const newPath = activeTab.history[newIndex];
      return updateActiveTab({
        path: newPath,
        historyIndex: newIndex,
        label: getBaseName(newPath),
        selection: new Set(),
      });
    }
    case 'NAVIGATE_FORWARD': {
      if (activeTab.historyIndex >= activeTab.history.length - 1) return state;
      const newIndex = activeTab.historyIndex + 1;
      const newPath = activeTab.history[newIndex];
      return updateActiveTab({
        path: newPath,
        historyIndex: newIndex,
        label: getBaseName(newPath),
        selection: new Set(),
      });
    }
    case 'NAVIGATE_UP': {
      const parent = getParentPath(activeTab.path);
      if (parent === activeTab.path) return state;
      const newHistory = activeTab.history.slice(0, activeTab.historyIndex + 1);
      newHistory.push(parent);
      return updateActiveTab({
        path: parent,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        label: getBaseName(parent),
        selection: new Set(),
        selectionPivot: null,
        scrollPosition: 0,
      });
    }
    case 'NEW_TAB': {
      const rawTarget = action.path || state.settings.startupFolder || '/';
      const target = rawTarget.trim() ? normalizePath(rawTarget) : '/';
      const newTab = createTab(target, state.settings.defaultView);
      return { ...state, tabs: [...state.tabs, newTab], activeTabId: newTab.id };
    }
    case 'CLOSE_TAB': {
      if (state.tabs.length === 1) return state;
      const idx = state.tabs.findIndex(t => t.id === action.id);
      const newTabs = state.tabs.filter(t => t.id !== action.id);
      const newActiveId = action.id === state.activeTabId
        ? (newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? newTabs[0].id)
        : state.activeTabId;
      return { ...state, tabs: newTabs, activeTabId: newActiveId };
    }
    case 'SWITCH_TAB':
      return { ...state, activeTabId: action.id };
    case 'REORDER_TABS': {
      const newTabs = [...state.tabs];
      const [removed] = newTabs.splice(action.fromIndex, 1);
      newTabs.splice(action.toIndex, 0, removed);
      return { ...state, tabs: newTabs };
    }
    case 'SET_VIEW_MODE':
      return updateActiveTab({ viewMode: action.mode });
    case 'SET_SORT':
      return updateActiveTab({ sortConfig: action.config });
    case 'SET_SELECTION': {
      const isNowEmpty = action.ids.size === 0;
      const ids = action.ids;
      return {
        ...updateActiveTab({ 
          selection: ids, 
          selectionPivot: ids.size === 1 ? Array.from(ids)[0] : activeTab.selectionPivot 
        }),
        contextMenu: isNowEmpty ? { ...state.contextMenu, visible: false } : state.contextMenu
      };
    }
    case 'SET_SELECTION_RANGE':
      return updateActiveTab({ selection: action.ids });
    case 'TOGGLE_SELECTION': {
      const newSel = new Set(activeTab.selection);
      let newPivot = activeTab.selectionPivot;
      if (newSel.has(action.id)) {
        newSel.delete(action.id);
        if (newPivot === action.id) newPivot = null;
      } else {
        newSel.add(action.id);
        newPivot = action.id;
      }
      return updateActiveTab({ selection: newSel, selectionPivot: newPivot });
    }
    case 'CLEAR_SELECTION':
      return {
        ...updateActiveTab({ selection: new Set(), selectionPivot: null }),
        contextMenu: { ...state.contextMenu, visible: false }
      };
    case 'SET_CLIPBOARD':
      return { ...state, clipboard: { items: action.items, operation: action.operation, sourceProvider: action.sourceProvider || 'local' } };
    case 'CLEAR_CLIPBOARD':
      return { ...state, clipboard: { items: [], operation: null } };
    case 'SET_DIALOG':
      return { ...state, dialog: action.dialog };
    case 'SET_CONTEXT_MENU':
      return { ...state, contextMenu: action.menu };
    case 'HIDE_CONTEXT_MENU':
      return { ...state, contextMenu: { ...state.contextMenu, visible: false } };
    case 'PUSH_UNDO':
      return { ...state, undoStack: [...state.undoStack, action.op].slice(-50), redoStack: [] };
    case 'POP_UNDO': {
      if (state.undoStack.length === 0) return state;
      const newUndo = [...state.undoStack];
      const op = newUndo.pop()!;
      return { ...state, undoStack: newUndo, redoStack: [...state.redoStack, op] };
    }
    case 'POP_REDO': {
      if (state.redoStack.length === 0) return state;
      const newRedo = [...state.redoStack];
      const op = newRedo.pop()!;
      return { ...state, redoStack: newRedo, undoStack: [...state.undoStack, op] };
    }
    case 'CLEAR_REDO':
      return { ...state, redoStack: [] };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.value };
    case 'TOGGLE_PREVIEW':
      return { ...state, previewVisible: !state.previewVisible };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query };
    case 'SET_IS_SEARCHING':
      return { ...state, isSearching: action.value };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'SET_TAB_SCROLL':
      return updateActiveTab({ scrollPosition: action.position });
    case 'RECORD_RECENT': {
      if (!action.path.trim() || action.path === '__recent__') return state;
      const normalized = normalizePath(action.path);
      if (normalized === '__recent__') return state;
      const newRecent = [normalized, ...state.settings.recentHistory.filter(p => p !== normalized)].slice(0, state.settings.recentHistoryLimit);
      return { ...state, settings: { ...state.settings, recentHistory: newRecent } };
    }
    case 'CLEAR_RECENT':
      return { ...state, settings: { ...state.settings, recentHistory: [] } };
    case 'SET_PLATFORM':
      return { ...state, platform: action.platform };
    case 'SET_VIEW':
      return { ...state, currentView: action.view };
    case 'ADD_TASK':
      return { ...state, tasks: [...state.tasks, action.task], dialog: { kind: 'none' } };
    case 'UPDATE_TASK':
      return { ...state, tasks: state.tasks.map(t => t.id === action.id ? { ...t, ...action.updates } : t) };
    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };
    case 'TOGGLE_FILTER_MONTH': {
      const exists = state.filters.months.includes(action.month);
      const months = exists
        ? state.filters.months.filter(m => m !== action.month)
        : [...state.filters.months, action.month];
      return { ...state, filters: { ...state.filters, months } };
    }
    case 'TOGGLE_FILTER_TYPE': {
      const exists = state.filters.types.includes(action.fileType);
      const types = exists
        ? state.filters.types.filter(t => t !== action.fileType)
        : [...state.filters.types, action.fileType];
      return { ...state, filters: { ...state.filters, types } };
    }
    case 'CLEAR_FILTERS':
      return { ...state, filters: { months: [], types: [] } };
    case 'SET_SEARCH_LEVEL':
      return { ...state, searchLevel: action.level };
    default:
      return state;
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadSession(defaultView: ViewMode, fallbackPath: string): Pick<AppState, 'tabs' | 'activeTabId'> | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializableSession;
    if (!parsed.tabs?.length) return null;

    const tabs: TabState[] = parsed.tabs.map(t => {
      const safePath = normalizePath(t.path || fallbackPath);
      const safeHistory = (t.history || [])
        .map(h => normalizePath(h || fallbackPath))
        .filter(Boolean);
      return {
        ...t,
        path: safePath,
        history: safeHistory.length ? safeHistory : [safePath],
        historyIndex: safeHistory.length
          ? Math.min(Math.max(t.historyIndex ?? 0, 0), safeHistory.length - 1)
          : 0,
        label: t.label || getBaseName(safePath),
        selection: new Set(t.selection || []),
        viewMode: t.viewMode || defaultView,
        selectionPivot: null,
        lastUpdated: t.lastUpdated || Date.now(),
      };
    });
    const activeTabId = tabs.some(t => t.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id;

    return { tabs, activeTabId };
  } catch {
    return null;
  }
}

function serializeSession(state: AppState): SerializableSession {
  return {
    tabs: state.tabs.map(t => ({
      ...t,
      selection: [...t.selection],
    })),
    activeTabId: state.activeTabId,
  };
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  activeTab: TabState;
  navigate: (path: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  navigateUp: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const settings = loadSettings();
  const startupRaw = settings.startupFolder?.trim() || '/';
  const startupPath = normalizePath(startupRaw);
  const restoredSession = loadSession(settings.defaultView, startupPath);

  const [state, dispatch] = useReducer(reducer, {
    tabs: restoredSession?.tabs ?? [createTab(startupPath, settings.defaultView, 'tab-1')],
    activeTabId: restoredSession?.activeTabId ?? 'tab-1',
    clipboard: { items: [], operation: null },
    settings,
    dialog: { kind: 'none' },
    contextMenu: { visible: false, x: 0, y: 0, targetEntries: [], isBackground: false },
    undoStack: [],
    redoStack: [],
    sidebarCollapsed: false,
    previewVisible: false,
    searchQuery: '',
    isSearching: false,
    platform: DEFAULT_PLATFORM_CAPABILITIES,
    currentView: 'files',
    tasks: [],
    filters: { months: [], types: [] },
    searchLevel: 1,
  });

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }, [state.settings]);

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeSession(state)));
  }, [state.tabs, state.activeTabId]);

  // ── Resolve Home Directory on Startup ───────────────────────────────────
  useEffect(() => {
    const startupResolved = localStorage.getItem('flashmesh.startup.resolved');
    if (startupResolved) return;

    if (state.platform.os === 'android') {
       dispatch({ type: 'NAVIGATE', path: '/storage/emulated/0' });
       localStorage.setItem('flashmesh.startup.resolved', 'true');
    } else if (state.platform.os !== 'unknown') {
       import('../api/tauri').then(({ fsApi }) => {
         fsApi.getHomeDir().then(home => {
           if (home) {
             dispatch({ type: 'NAVIGATE', path: home });
             localStorage.setItem('flashmesh.startup.resolved', 'true');
           }
         }).catch(() => {});
       });
    }
  }, [state.platform.os, dispatch]);

  const activeTab = state.tabs.find(t => t.id === state.activeTabId)!;

  const navigate = useCallback((path: string) => {
    if (!path || !path.trim()) return;
    dispatch({ type: 'NAVIGATE', path });
  }, []);
  const navigateBack = useCallback(() => dispatch({ type: 'NAVIGATE_BACK' }), []);
  const navigateForward = useCallback(() => dispatch({ type: 'NAVIGATE_FORWARD' }), []);
  const navigateUp = useCallback(() => dispatch({ type: 'NAVIGATE_UP' }), []);

  return (
    <AppContext.Provider value={{ state, dispatch, activeTab, navigate, navigateBack, navigateForward, navigateUp }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
