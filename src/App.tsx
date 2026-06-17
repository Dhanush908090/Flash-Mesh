import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AppProvider, DEFAULT_PLATFORM_CAPABILITIES, useApp } from './store/AppContext';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TabBar } from './components/Tabs/TabBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { FilePane } from './components/FilePane/FilePane';
import { PreviewPanel } from './components/PreviewPanel/PreviewPanel';
import { DialogManager } from './components/Dialogs/Dialogs';
import { Spotlight } from './components/Spotlight/Spotlight';
import { ToastContainer } from './components/Toast/Toast';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { terminalApi, opsApi, joinPathSync, platformApi, onFileOperationProgress } from './api/tauri';
import { showToast } from './components/Toast/Toast';
import type { FileEntry, Task } from './types';
import { MobileNav } from './components/Toolbar/MobileNav';
import { PetView } from './components/Pet/PetView';
import { DataPoolView } from './components/DataPool/DataPoolView';
import { dataPoolManager } from './mesh/DataPoolManager';
import { Cloud } from 'lucide-react';
import './App.css';
import { RECENT_PATH } from './utils/path';

function AppShell() {
  const { state, dispatch, activeTab } = useApp();
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const mobileSidebarInitialized = useRef(false);
  const mobileStartupRedirected = useRef(false);
  const errorReported = useRef<Set<string>>(new Set());

  // ── Global Error Reporting ───────────────────────────────────────────────
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      if (!state.settings.autoErrorReporting) return;
      const errorKey = `${event.message}-${event.lineno}`;
      if (errorReported.current.has(errorKey)) return;
      errorReported.current.add(errorKey);

      import('./utils/FeedbackService').then(({ feedbackService }) => {
        feedbackService.reportError(event.error || event.message, state.platform, state.settings);
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!state.settings.autoErrorReporting) return;
      const message = event.reason?.message || String(event.reason);
      if (errorReported.current.has(message)) return;
      errorReported.current.add(message);

      import('./utils/FeedbackService').then(({ feedbackService }) => {
        feedbackService.reportError(event.reason, state.platform, state.settings);
      });
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [state.settings.autoErrorReporting, state.settings.userEmail, state.platform, state.settings]);

  useEffect(() => {
    if (!state.previewVisible) setPreviewEntry(null);
  }, [state.previewVisible]);

  useEffect(() => {
    dataPoolManager.init().catch(err => {
      console.warn("Failed to initialize DataPoolManager:", err);
    });
  }, []);

  // ── Detect platform & form factor ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    platformApi.getCapabilities()
      .then(platform => {
        if (cancelled) return;
        dispatch({ type: 'SET_PLATFORM', platform });
        document.documentElement.dataset.platform = platform.os;
        document.documentElement.dataset.formFactor = platform.isMobile ? 'mobile' : 'desktop';
        if (platform.isMobile && !mobileSidebarInitialized.current) {
          mobileSidebarInitialized.current = true;
          dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
        }
      })
      .catch(() => {
        const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        const narrow = window.matchMedia?.('(max-width: 760px)').matches ?? false;
        const isMobile = coarse || narrow;
        document.documentElement.dataset.platform = isMobile ? 'mobile-web' : 'web';
        document.documentElement.dataset.formFactor = isMobile ? 'mobile' : 'desktop';
        dispatch({
          type: 'SET_PLATFORM',
          platform: {
            ...DEFAULT_PLATFORM_CAPABILITIES,
            os: isMobile ? 'mobile-web' : 'web',
            family: isMobile ? 'mobile' : 'desktop',
            isMobile,
          },
        });
        if (isMobile && !mobileSidebarInitialized.current) {
          mobileSidebarInitialized.current = true;
          dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
        }
      });
    return () => { cancelled = true; };
  }, [dispatch]);

  // ── Android permission bootstrap & reactive re-check ─────────────────────
  const checkAndRequestPermission = useCallback(async () => {
    if (state.platform.os !== 'android') return;
    const has = await platformApi.checkAndroidPermission().catch(() => false);
    if (has) {
      // Permission granted — redirect from bare '/' to the real Android root
      if (activeTab.path === '/' && !mobileStartupRedirected.current) {
        mobileStartupRedirected.current = true;
        dispatch({ type: 'NAVIGATE', path: '/storage/emulated/0' });
      }
    } else {
      showToast({ message: 'Storage permission needed. Please grant access.', duration: 5000 });
      if ((window as any).AndroidPermissionBridge) {
        (window as any).AndroidPermissionBridge.triggerPrompt();
      } else {
        await platformApi.requestAndroidPermission().catch(e => console.error('permission req:', e));
      }
    }
  }, [state.platform.os, activeTab.path, dispatch]);

  useEffect(() => {
    if (state.platform.os !== 'android') return;
    // Initial check shortly after platform is known
    const t = setTimeout(() => void checkAndRequestPermission(), 800);
    return () => clearTimeout(t);
  }, [state.platform.os, checkAndRequestPermission]);

  // Stable ref for activeTab to prevent re-registering Tauri listeners
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    // Listen for Tauri event emitted by Rust's request_android_permission
    const unlisten = listen('flashmesh:request-permission', () => {
      if ((window as any).AndroidPermissionBridge) {
        (window as any).AndroidPermissionBridge.triggerPrompt();
      } else {
        window.dispatchEvent(new CustomEvent('flashmesh:native-request-permission'));
      }
    });

    // Listen for Kotlin's notifyPermissionChanged event — re-check and navigate on grant
    const handlePermissionChanged = () => {
      void platformApi.checkAndroidPermission()
        .then(has => {
          if (has) {
            showToast({ message: 'Storage access granted!', duration: 2500 });
            mobileStartupRedirected.current = true;
            dispatch({ type: 'NAVIGATE', path: '/storage/emulated/0' });
          }
        })
        .catch(() => {});
    };
    window.addEventListener('flashmesh:permission-changed', handlePermissionChanged);
    
    // ── Android System Back Button ─────────────────────────────────────────
    // Kotlin fires 'flashmesh:system-back' when the user presses the OS
    // back button and canNavigateBack is true. We listen here to perform
    // the actual file navigation.
    const handleSystemBack = () => {
      const currentTab = activeTabRef.current;
      if (currentTab.historyIndex > 0) {
        dispatch({ type: 'NAVIGATE_BACK' });
      } else {
        dispatch({ type: 'NAVIGATE_UP' });
      }
    };
    window.addEventListener('flashmesh:system-back', handleSystemBack);

    return () => {
      void unlisten.then(fn => fn());
      window.removeEventListener('flashmesh:permission-changed', handlePermissionChanged);
      window.removeEventListener('flashmesh:system-back', handleSystemBack);
    };
  }, [dispatch]);

  // ── Tell Kotlin whether we can navigate back ────────────────────────────
  // This runs on every path change and synchronously sets a flag in Kotlin
  // so the back button handler knows instantly whether to navigate or close.
  useEffect(() => {
    if (state.platform.os !== 'android') return;
    const bridge = (window as any).AndroidPermissionBridge;
    if (!bridge?.updateBackState) return;
    const canGoBack = activeTab.path !== '/' && activeTab.path !== '/storage/emulated/0';
    try { bridge.updateBackState(canGoBack); } catch (_) {}
  }, [activeTab.path, state.platform.os]);

  // ── File Operation Progress Listener ────────────────────────────────────
  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    let lastUpdate = 0;
    
    unlisten = onFileOperationProgress((event) => {
      const now = Date.now();
      // Throttle updates to every 100ms per task to keep UI responsive
      if (now - lastUpdate < 100) return;
      lastUpdate = now;

      dispatch({ 
        type: 'UPDATE_TASK', 
        id: event.operationId, 
        updates: { 
          progress: event.percent,
          label: `${event.label} (${Math.round(event.percent)}%)`
        } 
      });
    });

    const unlistenError = listen('file-operation-error', (event) => {
      showToast({ message: `Background task error: ${event.payload}`, duration: 5000 });
    });

    return () => { 
      unlisten?.then(fn => fn()); 
      unlistenError.then(fn => fn());
    };
  }, [dispatch]);

  useEffect(() => {
    if (state.platform.isMobile && state.settings.hoverOpenItems) {
      dispatch({ type: 'UPDATE_SETTINGS', settings: { hoverOpenItems: false } });
    }
  }, [dispatch, state.platform.isMobile, state.settings.hoverOpenItems]);

  // Non-Android mobile startup redirect (e.g. iOS)
  useEffect(() => {
    if (
      state.platform.isMobile &&
      state.platform.os !== 'android' &&
      !state.settings.startupFolder &&
      activeTab.path === '/' &&
      !mobileStartupRedirected.current
    ) {
      mobileStartupRedirected.current = true;
      dispatch({ type: 'NAVIGATE', path: '/storage/emulated/0' });
    }
  }, [activeTab.path, dispatch, state.platform.isMobile, state.platform.os, state.settings.startupFolder]);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      if (state.settings.theme === 'elevanix') {
        root.dataset.theme = 'elevanix';
        return;
      }
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const resolved = state.settings.theme === 'system'
        ? (prefersLight ? 'light' : 'dark')
        : state.settings.theme;
      root.dataset.theme = resolved;
    };
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [state.settings.theme]);

  const isCollapsed = state.sidebarCollapsed;
  const hasPreview  = state.previewVisible && previewEntry !== null;

  const gridClass = [
    'app-root',
    isCollapsed ? 'app-root--sidebar-collapsed' : '',
    hasPreview   ? 'app-root--preview'           : '',
    state.platform.isMobile ? 'app-root--mobile' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={gridClass}>
      {state.platform.isMobile && !state.sidebarCollapsed && (
        <div 
          className="sidebar-overlay"
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })} 
        />
      )}
      <Sidebar />
      <TabBar />
      <Toolbar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTerminal={async (path) => {
          if (path === RECENT_PATH || !state.platform.supportsTerminal) return;
          try {
            await terminalApi.openTerminal(path);
          } catch (e: any) {
            showToast({ message: `Terminal failed: ${e}` });
          }
        }}
      />
      {state.currentView === 'files' && (
        <>
          <FilePane
            onOpenSpotlight={() => setSpotlightOpen(true)}
            onPreviewEntryChange={entry => setPreviewEntry(entry)}
          />
          {state.previewVisible && (
            <PreviewPanel
              entry={previewEntry}
              onClose={() => dispatch({ type: 'TOGGLE_PREVIEW' })}
            />
          )}
        </>
      )}

      {state.currentView === 'cloud' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', textAlign: 'center', background: 'var(--bg-base)' }}>
           <div style={{ padding: 24, borderRadius: '50%', background: 'var(--accent-muted)', marginBottom: 24 }}>
             <Cloud size={48} color="var(--accent)" />
           </div>
           <h2 style={{ fontSize: 20, marginBottom: 12 }}>Cloud Storage</h2>
           <p style={{ color: 'var(--text-secondary)', maxWidth: 320, lineHeight: 1.6 }}>
              Unified access to Google Drive and Dropbox. Authenticate in Settings to begin.
           </p>
           <button className="btn btn--primary" style={{ marginTop: 24 }} onClick={() => setSettingsOpen(true)}>
              Manage Accounts
           </button>
        </div>
      )}

      {state.currentView === 'pool' && (
        <DataPoolView />
      )}

      {state.currentView === 'pet' && (
        <PetView />
      )}

      <MobileNav />

      {/* Dialogs */}
      <DialogManager
        key={state.dialog.kind}
        onRenameConfirm={async (entry, newName) => {
          try {
            await opsApi.renameItem(entry.path, newName);
            dispatch({ type: 'RELOAD' });
            showToast({ message: `Renamed to "${newName}"` });
          } catch (e: any) {
            showToast({ message: `Rename failed: ${e}` });
          }
        }}
        onDeleteConfirm={async (entries, permanent) => {
          try {
            await opsApi.deleteItems(entries.map(e => e.path), permanent);
            dispatch({ type: 'CLEAR_SELECTION' });
            dispatch({ type: 'RELOAD' });
            showToast({ message: `Deleted ${entries.length} item${entries.length > 1 ? 's' : ''}` });
          } catch (e: any) {
            showToast({ message: `Delete failed: ${e}` });
          }
        }}
        onNewFolderConfirm={async (name) => {
          try {
            await opsApi.createFolder(joinPathSync(activeTab.path, name));
            dispatch({ type: 'RELOAD' });
            showToast({ message: `Created folder "${name}"` });
          } catch (e: any) {
            showToast({ message: `Failed: ${e}` });
          }
        }}
        onDragDropConfirm={(sourcePaths, destination, operation) => {
          const opId = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
          const task: Task = {
            id: opId,
            label: `${operation === 'copy' ? 'Copying' : 'Moving'} ${sourcePaths.length} items`,
            status: 'running',
            progress: 0,
            startTime: Date.now()
          };
          
          dispatch({ type: 'ADD_TASK', task });
          
          // Execute in background WITHOUT awaiting in the main confirmation handler
          setTimeout(async () => {
            try {
              if (operation === 'copy') {
                await opsApi.copyItems(sourcePaths, destination, opId);
              } else {
                await opsApi.moveItems(sourcePaths, destination, opId);
              }
              dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'completed', progress: 100 } });
              dispatch({ type: 'RELOAD' });
              showToast({ message: `${operation === 'copy' ? 'Copied' : 'Moved'} successfully` });
            } catch (e: any) {
              dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'failed', error: String(e) } });
              showToast({ message: `Operation failed: ${e}` });
            }
          }, 0);
        }}
      />

      {/* Spotlight Search */}
      {spotlightOpen && <Spotlight onClose={() => setSpotlightOpen(false)} />}

      {/* Settings */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* Toasts */}
      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default App;
