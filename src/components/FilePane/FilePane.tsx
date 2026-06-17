import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../../store/AppContext';
import { fsApi, opsApi, searchApi, terminalApi, onFileOperationProgress, joinPathSync } from '../../api/tauri';
import { FileGrid } from '../FileGrid/FileGrid';
import { FileList } from '../FileList/FileList';
import { StatusBar } from '../StatusBar/StatusBar';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { showToast } from '../Toast/Toast';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { isValidName } from '../../utils/fileDisplay';
import { useDragSelect } from '../../hooks/useDragSelect';
import { getBaseName, getParentPath, RECENT_PATH, TRASH_PATH } from '../../utils/path';
import type { FileEntry, SortField, FileOperation, Task } from '../../types';
import type { DirListing, SearchResult, ProgressEvent } from '../../api/tauri';
import { meshEngine } from '../../mesh/MeshEngine';
import { MSTIndexManager, IndexedEntry } from '../../mesh/mst';
import { Dashboard } from '../Dashboard/Dashboard';
import { executePaste, determinePasteStrategy, CloudProvider } from '../../mesh/ClipboardBridge';
import { dataPoolManager } from '../../mesh/DataPoolManager';
import { googleAdapter, dropboxAdapter } from '../../mesh/MeshEngine';

function sortEntries(entries: FileEntry[], field: SortField, dir: 'asc' | 'desc'): FileEntry[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.isDir !== b.entry.isDir) return a.entry.isDir ? -1 : 1;

      let cmp = 0;
      if (field === 'name') cmp = collator.compare(a.entry.name, b.entry.name);
      if (field === 'size') cmp = (a.entry.size ?? 0) - (b.entry.size ?? 0);
      if (field === 'modified') cmp = (a.entry.modified ?? '').localeCompare(b.entry.modified ?? '');
      if (field === 'type') cmp = collator.compare(a.entry.extension ?? '', b.entry.extension ?? '');
      if (cmp === 0) cmp = a.index - b.index;
      return dir === 'asc' ? cmp : -cmp;
    })
    .map(({ entry }) => entry);
}

interface FilePaneProps {
  onOpenSpotlight: () => void;
  onPreviewEntryChange: (entry: FileEntry | null) => void;
}

export function FilePane({ onOpenSpotlight, onPreviewEntryChange }: FilePaneProps) {
  const { activeTab, navigate, dispatch, state } = useApp();
  const mstIndex = useMemo(() => new MSTIndexManager(), []);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [homeDir, setHomeDir] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [hoverOpenCue, setHoverOpenCue] = useState<{ x: number; y: number; name: string } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const startupRecoveryTried = useRef(false);
  const hoverOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEntryRef = useRef<FileEntry | null>(null);
  const hoverOpenOrigin = useRef<{ x: number; y: number } | null>(null);
  const lastDragTime = useRef<number>(0);
  const isDraggingInternal = useRef<boolean>(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  
  const { handlers: dragHandlers, dragStyles } = useDragSelect(ids => {
    dispatch({ type: 'SET_SELECTION', ids });
    lastDragTime.current = Date.now();
    isDraggingInternal.current = true;
  });

  useEffect(() => {
    fsApi.getHomeDir().then(setHomeDir).catch(() => setHomeDir('/'));
    
    const onGlobalPointerUp = () => {
      setTimeout(() => { isDraggingInternal.current = false; }, 300);
    };
    window.addEventListener('pointerup', onGlobalPointerUp);
    
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerUp);
    };
  }, []);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      if (path === RECENT_PATH) {
        const historyPaths = (state.settings.recentHistory || []).filter(p => p !== RECENT_PATH);
        const metadataPromises = historyPaths.map(p => fsApi.getFileMetadata(p));
        const entries = (await Promise.all(metadataPromises))
          .filter((e): e is FileEntry => e !== null);
          
        setListing({
          path: RECENT_PATH,
          entries: entries,
          parent: null,
          error: null,
        });
      } else if (path === TRASH_PATH) {
        const data = await fsApi.listTrash();
        setListing(data);
      } else if (path.startsWith('mesh://')) {
        const url = new URL(path);
        const cloudPath = url.pathname === '/' ? '' : url.pathname;
        let entries: FileEntry[] = [];
        
        try {
          entries = await meshEngine.listUnifiedDirectory(cloudPath);
        } catch (err: any) {
           throw new Error(`Cloud fetch failed: ${err.message || String(err)}`);
        }

        setListing({
          path,
          entries,
          parent: cloudPath ? `mesh://root${cloudPath.substring(0, cloudPath.lastIndexOf('/')) || '/'}` : null,
          error: null
        });
      } else if (path.startsWith('pool://')) {
        const parts = path.substring('pool://'.length).split('/');
        const poolId = parts[0];
        const folderId = parts[1] || null;
        
        let poolItems = { folders: [] as any[], files: [] as any[] };
        try {
          poolItems = dataPoolManager.getPoolContents(poolId, folderId);
        } catch (err: any) {
          throw new Error(`Pool fetch failed: ${err.message || String(err)}`);
        }

        const entries: FileEntry[] = [];
        
        for (const f of poolItems.folders) {
          entries.push({
            id: f.id,
            name: f.name,
            path: `pool://${poolId}/${f.id}`,
            isDir: true,
            size: null,
            modified: null,
            created: f.created ? new Date(f.created).toISOString() : null,
            extension: null,
            isHidden: false,
            isSymlink: false,
            mimeType: null,
            provider: 'pool',
            isPoolFile: true,
            poolId: poolId
          });
        }

        for (const f of poolItems.files) {
          entries.push({
            id: f.id,
            name: f.name,
            path: `pool://${poolId}/${f.id}`,
            isDir: false,
            size: f.size,
            modified: f.modified || (f.uploadedAt ? new Date(f.uploadedAt).toISOString() : null),
            created: f.created || null,
            extension: f.extension || f.name.split('.').pop() || '',
            isHidden: false,
            isSymlink: false,
            mimeType: f.mimeType || 'application/octet-stream',
            provider: 'pool',
            isPoolFile: true,
            poolId: poolId,
            isPending: f.isPending
          });
        }

        let parentPath: string | null = null;
        if (folderId) {
          const pool = dataPoolManager.pools.get(poolId);
          const currentFolder = pool?.folders?.find((x: any) => x.id === folderId);
          if (currentFolder) {
            parentPath = currentFolder.parentFolderId
              ? `pool://${poolId}/${currentFolder.parentFolderId}`
              : `pool://${poolId}`;
          } else {
            parentPath = `pool://${poolId}`;
          }
        }

        setListing({
          path,
          entries,
          parent: parentPath,
          error: null
        });
      } else {
        const data = await fsApi.listDirectory(path, state.settings.showHiddenFiles);
        setListing(data);
        if (
          data.error &&
          !startupRecoveryTried.current &&
          path === activeTab.path &&
          homeDir &&
          homeDir !== path
        ) {
          startupRecoveryTried.current = true;
          showToast({ message: `Recovered to home: ${data.error}` });
          navigate(homeDir);
        }
      }
    } catch (e: any) {
      const reason = typeof e === 'string' ? e : (e?.message || String(e));
      setListing({
        path,
        entries: [],
        parent: null,
        error: reason || `Cannot open: ${path}`,
      });
      showToast({ message: reason ? `Cannot open: ${path} (${reason})` : `Cannot open: ${path}` });
    } finally {
      setLoading(false);
    }
  }, [homeDir, state.settings.showHiddenFiles, activeTab.path, navigate]);

  useEffect(() => { loadDir(activeTab.path); }, [activeTab.path, activeTab.lastUpdated, state.settings.showHiddenFiles, loadDir]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onFileOperationProgress((evt) => {
      setProgress(evt);
      if (evt.percent >= 100) {
        setTimeout(() => setProgress(null), 800);
      }
    }).then(fn => { unlisten = fn; }).catch(() => {});
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    if (!state.isSearching || !state.searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      try {
        const root = activeTab.path === RECENT_PATH ? homeDir : activeTab.path;
        const results = await searchApi.searchFiles(root, state.searchQuery, state.settings.showHiddenFiles, 200, state.searchLevel);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 250);
  }, [state.searchQuery, state.isSearching, activeTab.path, state.settings.showHiddenFiles, homeDir, state.searchLevel]);

  useEffect(() => {
    if (listing?.entries) {
      const indexed: IndexedEntry[] = listing.entries.map(e => ({
        key: e.name,
        value: e
      }));
      mstIndex.buildIndex(indexed);
    }
  }, [listing?.entries, mstIndex]);

  const rawEntries: FileEntry[] = useMemo(() => {
    if (state.isSearching && state.searchQuery.trim()) {
      const tokenMatches = mstIndex.searchByToken(state.searchQuery);
      if (tokenMatches.length > 0) {
        return tokenMatches.map(m => m.value as FileEntry);
      }
      return searchResults.map(r => r.entry);
    }
    return listing?.entries ?? [];
  }, [state.isSearching, state.searchQuery, searchResults, listing?.entries, mstIndex]);

  const getFileTypeCategory = (ext: string | null): string => {
    if (!ext) return 'other';
    const e = ext.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'heic'].includes(e)) return 'image';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'].includes(e)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'].includes(e)) return 'audio';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods'].includes(e)) return 'document';
    if (['ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'py', 'c', 'cpp', 'h', 'html', 'css', 'json', 'yaml', 'toml', 'sh', 'bat', 'ps1', 'xml'].includes(e)) return 'code';
    return 'other';
  };

  const filteredRawEntries = useMemo(() => {
    const isFiltersActive = state.filters.months.length > 0 || state.filters.types.length > 0;
    if (!isFiltersActive) return rawEntries;

    return rawEntries.filter(entry => {
      if (entry.isDir) return true;

      // Type match
      if (state.filters.types.length > 0) {
        const cat = getFileTypeCategory(entry.extension);
        if (!state.filters.types.includes(cat)) return false;
      }

      // Month match
      if (state.filters.months.length > 0) {
        if (!entry.modified) return false;
        const month = entry.modified.substring(5, 7); // YYYY-MM
        if (!state.filters.months.includes(month)) return false;
      }

      return true;
    });
  }, [rawEntries, state.filters]);

  const entries = useMemo(
    () => sortEntries(filteredRawEntries, activeTab.sortConfig.field, activeTab.sortConfig.direction),
    [filteredRawEntries, activeTab.sortConfig]
  );

  const selectedEntries = useMemo(
    () => entries.filter(e => activeTab.selection.has(e.id)),
    [entries, activeTab.selection]
  );

  const totalSelectedSize = selectedEntries.reduce((sum, e) => sum + (e.size ?? 0), 0);

  useEffect(() => {
    const selected = entries.find(e => activeTab.selection.has(e.id)) ?? null;
    onPreviewEntryChange(selected);
    if (selected && !selected.isDir) {
      if (selected.id !== lastSelectedIdRef.current) {
        lastSelectedIdRef.current = selected.id;
        dispatch({ type: 'SET_PREVIEW_VISIBLE', value: true });
      }
    } else {
      lastSelectedIdRef.current = null;
    }
  }, [entries, activeTab.selection, onPreviewEntryChange, dispatch]);

  useEffect(() => {
    setFocusedIndex(0);
  }, [activeTab.path, state.searchQuery, state.isSearching]);

  const handleOpen = useCallback(async (entry: FileEntry) => {
    dispatch({ type: 'RECORD_RECENT', path: entry.path });
    if (entry.isDir) {
      navigate(entry.path);
    } else if (entry.path.startsWith('pool://')) {
      const parts = entry.path.substring('pool://'.length).split('/');
      const poolId = parts[0];
      const fileId = parts[1];
      showToast({ message: `Downloading ${entry.name} from pool...` });
      try {
        const blob = await dataPoolManager.downloadFromPool(poolId, fileId);
        const dirs = await fsApi.getSpecialDirs();
        const baseDir = dirs.downloads || homeDir || '.';
        const fullPath = joinPathSync(baseDir, entry.name);
        const arrayBuf = await blob.arrayBuffer();
        await opsApi.writeBinaryFile(fullPath, new Uint8Array(arrayBuf));
        showToast({ message: `Downloaded to ${entry.name}. Opening...` });
        await opsApi.openItem(fullPath);
      } catch (err: any) {
        showToast({ message: `Failed to open pool file: ${err.message || String(err)}` });
      }
    } else if (entry.path.startsWith('mesh://')) {
      showToast({ message: `Downloading ${entry.name} from cloud...` });
      try {
        const defaultKeyMaterial = new TextEncoder().encode('flashmesh-default-mesh-passphrase-master-v1').buffer;
        const adapter = entry.provider === 'google' ? googleAdapter : dropboxAdapter;
        
        const downloadManifest = async (adapter: any, fileName: string): Promise<string> => {
          const dec = new TextDecoder();
          if (adapter.provider === 'google') {
            const files = await adapter.listFolder('');
            const found = files.find((f: any) => f.name === fileName);
            if (!found) throw new Error(`Manifest not found: ${fileName}`);
            const buf = await adapter.downloadChunk(found.id);
            return dec.decode(buf);
          } else {
            const path = `/FlashMesh/Manifests/${fileName}`;
            const buf = await adapter.downloadChunk(path);
            return dec.decode(buf);
          }
        };

        const manifestJson = await downloadManifest(adapter, `${entry.name}.oro`);
        const manifest = JSON.parse(manifestJson);
        const blob = await meshEngine.downloadFile(manifest, defaultKeyMaterial);
        
        const dirs = await fsApi.getSpecialDirs();
        const baseDir = dirs.downloads || homeDir || '.';
        const fullPath = joinPathSync(baseDir, entry.name);
        const arrayBuf = await blob.arrayBuffer();
        await opsApi.writeBinaryFile(fullPath, new Uint8Array(arrayBuf));
        showToast({ message: `Downloaded to ${entry.name}. Opening...` });
        await opsApi.openItem(fullPath);
      } catch (err: any) {
        showToast({ message: `Failed to open cloud file: ${err.message || String(err)}` });
      }
    } else {
      const bridge = (window as any).AndroidPermissionBridge || (window as any).AndroidBridge;
      if (state.platform.os === 'android' && bridge?.openFile) {
        bridge.openFile(entry.path);
      } else {
        opsApi.openItem(entry.path).catch(e => showToast({ message: `Open failed: ${e}` }));
      }
    }
  }, [navigate, dispatch, state.platform.os, homeDir]);

  const cancelHoverOpen = useCallback(() => {
    if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
    if (stabilityTimer.current) clearTimeout(stabilityTimer.current);
  }, []);
  
  const hoverOpenTimerAction = useCallback(() => {
    hoverOpenTimer.current = null;
    stabilityTimer.current = null;
    hoverOpenOrigin.current = null;
    hoverEntryRef.current = null;
    setHoverOpenCue(null);
  }, []);

  const startHoverTimerAfterStability = useCallback((entry: FileEntry, x: number, y: number) => {
    if (stabilityTimer.current) clearTimeout(stabilityTimer.current);
    if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
    setHoverOpenCue(null); // Hide progress indicator while moving

    // Wait 150ms of perfect stability before showing cue and starting the primary delay
    stabilityTimer.current = setTimeout(() => {
      setHoverOpenCue({ x, y, name: entry.name });
      hoverOpenTimer.current = setTimeout(() => {
        hoverOpenTimer.current = null;
        setHoverOpenCue(null);
        handleOpen(entry);
      }, state.settings.hoverOpenDelay);
    }, 150);
  }, [state.settings.hoverOpenDelay, handleOpen]);

  const beginHoverOpen = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    if (!state.settings.hoverOpenItems || renamingId) return;
    cancelHoverOpen();
    hoverEntryRef.current = entry;
    hoverOpenOrigin.current = { x: e.clientX, y: e.clientY };
    startHoverTimerAfterStability(entry, e.clientX, e.clientY);
  }, [cancelHoverOpen, renamingId, state.settings.hoverOpenItems, startHoverTimerAfterStability]);

  const handleHoverOpenMove = useCallback((e: React.MouseEvent) => {
    if (!hoverOpenOrigin.current || !hoverEntryRef.current) return;
    const dx = Math.abs(e.clientX - hoverOpenOrigin.current.x);
    const dy = Math.abs(e.clientY - hoverOpenOrigin.current.y);
    // Tolerate slightly unsteady hands (3px)
    if (dx > 3 || dy > 3) {
      hoverOpenOrigin.current = { x: e.clientX, y: e.clientY };
      startHoverTimerAfterStability(hoverEntryRef.current, e.clientX, e.clientY);
    }
  }, [startHoverTimerAfterStability]);

  useEffect(() => cancelHoverOpen, [activeTab.path, cancelHoverOpen]);

  const pushUndo = (op: FileOperation) => dispatch({ type: 'PUSH_UNDO', op });

  const handleCopy = useCallback(() => {
    if (selectedEntries.length === 0) return;
    dispatch({ type: 'SET_CLIPBOARD', items: selectedEntries, operation: 'copy' });
    showToast({ message: `Copied ${selectedEntries.length} item${selectedEntries.length > 1 ? 's' : ''}` });
  }, [selectedEntries, dispatch]);

  const handleCut = useCallback(() => {
    if (selectedEntries.length === 0) return;
    dispatch({ type: 'SET_CLIPBOARD', items: selectedEntries, operation: 'cut' });
    showToast({ message: `Cut ${selectedEntries.length} item${selectedEntries.length > 1 ? 's' : ''}` });
  }, [selectedEntries, dispatch]);

  const handlePaste = useCallback(() => {
    const { clipboard } = state;
    if (!clipboard.operation || clipboard.items.length === 0 || activeTab.path === RECENT_PATH) return;
    
    const opId = crypto.randomUUID();
    const isCopy = clipboard.operation === 'copy';
    const destPath = activeTab.path;

    const task: Task = {
      id: opId,
      label: `${isCopy ? 'Copying' : 'Moving'} ${clipboard.items.length} item${clipboard.items.length > 1 ? 's' : ''}`,
      status: 'running',
      progress: 0,
      startTime: Date.now(),
    };
    dispatch({ type: 'ADD_TASK', task });

    // Clear clipboard if cut
    if (!isCopy) {
      dispatch({ type: 'CLEAR_CLIPBOARD' });
    }

    // Resolve providers
    const clipboardFiles = clipboard.items.map(item => {
      let provider: CloudProvider = 'local';
      if (item.path.startsWith('pool://')) {
        provider = 'pool';
      } else if (item.path.startsWith('mesh://')) {
        provider = item.provider || 'google';
      }
      return {
        path: item.path,
        name: item.name,
        size: item.size || 0,
        provider
      };
    });

    let destProvider: CloudProvider = 'local';
    if (destPath.startsWith('pool://')) {
      destProvider = 'pool';
    } else if (destPath.startsWith('mesh://')) {
      destProvider = 'google';
    }

    const strategy = determinePasteStrategy(
      clipboardFiles[0]?.provider || 'local',
      destProvider
    );

    setTimeout(async () => {
      try {
        const result = await executePaste(
          clipboardFiles,
          destPath,
          clipboard.operation!,
          strategy,
          (pct, lbl) => {
            dispatch({
              type: 'UPDATE_TASK',
              id: opId,
              updates: { progress: pct, label: `${lbl} (${pct}%)` }
            });
          }
        );

        if (result.success) {
          dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'completed', progress: 100 } });
          showToast({ message: `${isCopy ? 'Copied' : 'Moved'} successfully` });
        } else {
          dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'failed', error: result.error } });
          showToast({ message: `Paste failed: ${result.error}` });
        }
      } catch (e: any) {
        dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'failed', error: String(e) } });
        showToast({ message: `Paste failed: ${e}` });
      }
      loadDir(destPath);
    }, 0);
  }, [state, activeTab.path, dispatch, loadDir]);

  const handleDelete = useCallback(async (permanent: boolean) => {
    if (selectedEntries.length === 0) return;
    if (!permanent && !state.platform.supportsTrash) {
      dispatch({ type: 'SET_DIALOG', dialog: { kind: 'delete', entries: selectedEntries, permanent: true } });
      return;
    }

    if (state.settings.confirmBeforeDelete) {
      dispatch({ type: 'SET_DIALOG', dialog: { kind: 'delete', entries: selectedEntries, permanent } });
      return;
    }

    await doDelete(selectedEntries, permanent);
  }, [selectedEntries, state.settings.confirmBeforeDelete, state.platform.supportsTrash, dispatch]);

  const doDelete = async (items: FileEntry[], permanent: boolean) => {
    if (activeTab.path === TRASH_PATH) {
      showToast({ message: 'Individual item deletion in Trash is not supported. Use Empty Trash.' });
      return;
    }

    if (activeTab.path.startsWith('pool://')) {
      const parts = activeTab.path.substring('pool://'.length).split('/');
      const poolId = parts[0];
      const idsToDelete = new Set(items.map(e => e.id));
      setListing(prev => prev ? { ...prev, entries: prev.entries.filter(en => !idsToDelete.has(en.id)) } : null);
      try {
        for (const item of items) {
          if (item.isDir) {
            await dataPoolManager.deleteFolder(poolId, item.id);
          } else {
            await dataPoolManager.deleteFile(poolId, item.id);
          }
        }
        dispatch({ type: 'CLEAR_SELECTION' });
        showToast({ message: `Deleted ${items.length} pool item${items.length > 1 ? 's' : ''}` });
      } catch (err: any) {
        showToast({ message: `Pool delete failed: ${err.message || String(err)}` });
        loadDir(activeTab.path);
      }
      return;
    }

    if (activeTab.path.startsWith('mesh://')) {
      const idsToDelete = new Set(items.map(e => e.id));
      setListing(prev => prev ? { ...prev, entries: prev.entries.filter(en => !idsToDelete.has(en.id)) } : null);
      
      try {
         // In full implementation, meshEngine.deleteFile(manifest) would run.
         // For now, optimistic UI
         dispatch({ type: 'CLEAR_SELECTION' });
         showToast({ message: `Deleted ${items.length} unified cloud item${items.length > 1 ? 's' : ''}` });
      } catch (e: any) {
        showToast({ message: `Cloud delete failed: ${e}` });
        loadDir(activeTab.path);
      }
      return;
    }

    const paths = items.map(e => e.path);
    const idsToDelete = new Set(items.map(e => e.id));

    // Optimistically remove from view
    setListing(prev => prev ? {
      ...prev,
      entries: prev.entries.filter(en => !idsToDelete.has(en.id))
    } : null);

    try {
      await opsApi.deleteItems(paths, permanent);
      dispatch({ type: 'CLEAR_SELECTION' });
      showToast({
        message: `Deleted ${paths.length} item${paths.length > 1 ? 's' : ''}`,
      });
    } catch (e: any) {
      showToast({ message: `Delete failed: ${e}` });
      // Revert if failed
      loadDir(activeTab.path);
    }
  };

  const handleRename = useCallback(() => {
    if (selectedEntries.length !== 1) return;
    setRenamingId(selectedEntries[0].id);
  }, [selectedEntries]);

  const doRename = useCallback(async (entry: FileEntry, newName: string) => {
    if (!isValidName(newName)) {
      showToast({ message: 'Invalid name. Avoid / \\ : * ? " < > |' });
      return;
    }
    if (entries.some(e => e.name === newName && e.id !== entry.id)) {
      showToast({ message: `An item named "${newName}" already exists.` });
      return;
    }

    setRenamingId(null);
    if (activeTab.path.startsWith('pool://')) {
      const parts = activeTab.path.substring('pool://'.length).split('/');
      const poolId = parts[0];
      try {
        if (entry.isDir) {
          await dataPoolManager.renameFolder(poolId, entry.id, newName);
        } else {
          await dataPoolManager.renameFile(poolId, entry.id, newName);
        }
        showToast({ message: `Renamed to "${newName}"` });
      } catch (err: any) {
        showToast({ message: `Rename failed: ${err.message || String(err)}` });
      }
      loadDir(activeTab.path);
      return;
    }

    try {
      const nextPath = await opsApi.renameItem(entry.path, newName);
      pushUndo({
        id: crypto.randomUUID(),
        kind: 'rename',
        label: `Rename ${entry.name}`,
        timestamp: Date.now(),
        undo: { type: 'rename', path: nextPath, newName: entry.name },
        redo: { type: 'rename', path: entry.path, newName },
      });
      showToast({ message: `Renamed to "${newName}"` });
    } catch (e: any) {
      showToast({ message: `Rename failed: ${e}` });
    }
    loadDir(activeTab.path);
  }, [activeTab.path, loadDir, entries]);

  const handleNewFolder = useCallback(() => {
    if (activeTab.path === RECENT_PATH) return;
    dispatch({ type: 'SET_DIALOG', dialog: { kind: 'newFolder', parentPath: activeTab.path } });
  }, [activeTab.path, dispatch]);

  const handleDropItems = useCallback((targetDir: string, sourceIds: string[], copy: boolean) => {
    if (!targetDir || targetDir === RECENT_PATH) return;
    const sourceEntries = entries.filter(e => sourceIds.includes(e.id));
    const sources = sourceEntries.map(e => e.path).filter(p => p !== targetDir);
    if (sources.length === 0) return;

    if (state.settings.dragDropAction === 'ask') {
      dispatch({ type: 'SET_DIALOG', dialog: { kind: 'dragDrop', sourcePaths: sources, destination: targetDir } });
      return;
    }

    const opId = crypto.randomUUID();
    const isCopy = state.settings.dragDropAction === 'copy';
    const destPath = targetDir;

    const task: Task = {
      id: opId,
      label: `${isCopy ? 'Copying' : 'Moving'} ${sources.length} item${sources.length > 1 ? 's' : ''}`,
      status: 'running',
      progress: 0,
      startTime: Date.now(),
    };
    dispatch({ type: 'ADD_TASK', task });
    dispatch({ type: 'CLEAR_SELECTION' });

    // Fire-and-forget: Rust returns immediately; actual work runs on a background thread
    setTimeout(async () => {
      try {
        if (isCopy) {
          await opsApi.copyItems(sources, destPath, opId);
        } else {
          await opsApi.moveItems(sources, destPath, opId);
        }
        dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'completed', progress: 100 } });
        showToast({ message: `${isCopy ? 'Copied' : 'Moved'} ${sources.length} item${sources.length > 1 ? 's' : ''}` });
      } catch (e: any) {
        dispatch({ type: 'UPDATE_TASK', id: opId, updates: { status: 'failed', error: String(e) } });
        showToast({ message: `Drop failed: ${e}` });
      }
      loadDir(activeTab.path);
    }, 0);
  }, [entries, dispatch, activeTab.path, loadDir]);

  const doNewFolder = useCallback(async (name: string) => {
    if (activeTab.path === RECENT_PATH) return;
    if (!isValidName(name)) {
      showToast({ message: 'Invalid folder name.' });
      return;
    }
    
    if (activeTab.path.startsWith('pool://')) {
      const parts = activeTab.path.substring('pool://'.length).split('/');
      const poolId = parts[0];
      const folderId = parts[1] || null;
      try {
        await dataPoolManager.createFolder(poolId, name, folderId);
        showToast({ message: `Created folder "${name}"` });
        loadDir(activeTab.path);
      } catch (err: any) {
        showToast({ message: `Failed to create folder: ${err.message || String(err)}` });
      }
      return;
    }

    if (activeTab.path.startsWith('mesh://')) {
      showToast({ message: 'Cloud folders must be created via the Mesh API (Coming soon in full Mesh architecture).' });
      return;
    }

    const fullPath = joinPathSync(activeTab.path, name);
    try {
      await opsApi.createFolder(fullPath);
      showToast({ message: `Created folder "${name}"` });
    } catch (e: any) {
      showToast({ message: `Failed: ${e}` });
    }
    loadDir(activeTab.path);
  }, [activeTab.path, loadDir]);

  const handleNewFile = useCallback(async () => {
    if (activeTab.path === RECENT_PATH) return;
    const name = 'New File.txt';
    const fullPath = joinPathSync(activeTab.path, name);
    try {
      await opsApi.createFile(fullPath);
      showToast({ message: `Created file "${name}"` });
    } catch (e: any) {
      showToast({ message: `Failed: ${e}` });
    }
    loadDir(activeTab.path);
  }, [activeTab.path, loadDir]);

  const handleContextMenu = useCallback((e: React.MouseEvent, ctxEntries: FileEntry[], isBackground: boolean) => {
    e.preventDefault();
    dispatch({
      type: 'SET_CONTEXT_MENU',
      menu: { visible: true, x: e.clientX, y: e.clientY, targetEntries: ctxEntries, isBackground },
    });
  }, [dispatch]);

  const handleSelectAll = useCallback(() => {
    dispatch({ type: 'SET_SELECTION', ids: new Set(entries.map(e => e.id)) });
  }, [entries, dispatch]);

  const handleRefresh = useCallback(() => { loadDir(activeTab.path); }, [activeTab.path, loadDir]);

  const applyOperation = useCallback(async (op: FileOperation['undo'] | FileOperation['redo']) => {
    if (op.type === 'rename' && op.path && op.newName) {
      await opsApi.renameItem(op.path, op.newName);
    }
    if (op.type === 'delete' && op.sources?.length) {
      await opsApi.deleteItems(op.sources, true);
    }
    if (op.type === 'move' && op.sources?.length && op.destination) {
      await opsApi.moveItems(op.sources, op.destination, crypto.randomUUID());
    }
  }, []);

  const handleUndo = useCallback(async () => {
    const op = state.undoStack[state.undoStack.length - 1];
    if (!op) return;
    try {
      await applyOperation(op.undo);
      dispatch({ type: 'POP_UNDO' });
      showToast({ message: `Undid: ${op.label}` });
      loadDir(activeTab.path);
    } catch (e: any) {
      showToast({ message: `Undo failed: ${e}` });
    }
  }, [state.undoStack, applyOperation, dispatch, loadDir, activeTab.path]);

  const handleRedo = useCallback(async () => {
    const op = state.redoStack[state.redoStack.length - 1];
    if (!op) return;
    try {
      await applyOperation(op.redo);
      dispatch({ type: 'POP_REDO' });
      showToast({ message: `Redid: ${op.label}` });
      loadDir(activeTab.path);
    } catch (e: any) {
      showToast({ message: `Redo failed: ${e}` });
    }
  }, [state.redoStack, applyOperation, dispatch, loadDir, activeTab.path]);

  const handleOpenTerminal = useCallback(async () => {
    if (!state.platform.supportsTerminal) return;
    const path = selectedEntries[0]?.isDir ? selectedEntries[0].path : activeTab.path;
    if (path === RECENT_PATH) return;
    try {
      await terminalApi.openTerminal(path);
    } catch (e: any) {
      showToast({ message: `Terminal failed: ${e}` });
    }
  }, [selectedEntries, activeTab.path, state.platform.supportsTerminal]);

  useKeyboardShortcuts({
    selectedEntries,
    currentPath: activeTab.path,
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: handlePaste,
    onDelete: handleDelete,
    onRename: handleRename,
    onNewFolder: handleNewFolder,
    onNewFile: handleNewFile,
    onOpen: handleOpen,
    onSelectAll: handleSelectAll,
    onRefresh: handleRefresh,
    onOpenSpotlight,
    onUndo: handleUndo,
    onRedo: handleRedo,
  });

  useEffect(() => {
    const hide = () => dispatch({ type: 'HIDE_CONTEXT_MENU' });
    window.addEventListener('click', hide);
    return () => window.removeEventListener('click', hide);
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') return;
      if (state.dialog.kind !== 'none') return;
      if (entries.length === 0 || state.isSearching) return;
      if (e.altKey) return; // Let useKeyboardShortcuts handle history/up navigation

      const selectByIndex = (idx: number) => {
        const bounded = Math.max(0, Math.min(idx, entries.length - 1));
        setFocusedIndex(bounded);
        dispatch({ type: 'SET_SELECTION', ids: new Set([entries[bounded].id]) });
      };

      const getColumns = () => {
        if (activeTab.viewMode !== 'grid') return 1;
        const container = document.querySelector('.file-grid');
        const firstItem = document.querySelector('.file-card');
        if (!container || !firstItem) return 1;
        const containerWidth = container.clientWidth;
        const itemWidth = firstItem.clientWidth + 4; // width + gap
        return Math.max(1, Math.floor(containerWidth / itemWidth));
      };

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cols = getColumns();
        selectByIndex(focusedIndex + cols);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cols = getColumns();
        selectByIndex(focusedIndex - cols);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectByIndex(focusedIndex + 1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectByIndex(focusedIndex - 1);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        selectByIndex(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        selectByIndex(entries.length - 1);
      }
      if (e.key === 'Enter' && activeTab.selection.size === 1) {
        const selected = entries.find(item => activeTab.selection.has(item.id));
        if (selected) {
          e.preventDefault();
          handleOpen(selected);
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [entries, focusedIndex, dispatch, handleOpen, activeTab.selection, state.dialog.kind, state.isSearching]);

  const { contextMenu } = state;

  return (
    <>
      <div
        ref={mainAreaRef}
        className="main-area"
        onContextMenu={e => { e.preventDefault(); handleContextMenu(e, [], true); }}
      >
        <div 
          className="file-pane" 
          onDragStart={(e) => {
            // Disable native drag if we are in selection mode to prevent ghosting/highlighting
            if (isDraggingInternal.current) e.preventDefault();
          }}
          onClick={(e) => {
             // Only clear if we clicked the pane background directly, not a file card
             // AND we didn't just finish a drag (prevents unselect after drag)
             const justDragged = Date.now() - lastDragTime.current < 400 || isDraggingInternal.current;
             if ((e.target as Element).classList.contains('file-pane') && !justDragged) {
               dispatch({ type: 'CLEAR_SELECTION' });
             }
          }}
          {...dragHandlers}
        >
          {(() => {
            const p = activeTab.path;
            const isDashboardPath = state.platform.isMobile && p === '/';

            if (isDashboardPath) {
              // On mobile virtual root, only show the Dashboard — no file grid.
              return <Dashboard />;
            }

            return (
              <>
                {activeTab.path === RECENT_PATH && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Recent History</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Files and folders you've navigated to or opened.</p>
                    </div>
                    {entries.length > 0 && (
                      <button
                        className="btn btn--secondary"
                        onClick={() => {
                          dispatch({ type: 'CLEAR_RECENT' });
                          setListing({ path: RECENT_PATH, entries: [], parent: null, error: null });
                        }}
                        style={{ fontSize: 13, padding: '6px 12px' }}
                      >
                        Clear History
                      </button>
                    )}
                  </div>
                )}

                {activeTab.path === TRASH_PATH && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Trash</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Files in your system's Recycle Bin.</p>
                    </div>
                    {entries.length > 0 && (
                      <button
                        className="btn btn--secondary"
                        onClick={async () => {
                          if (confirm('Are you sure you want to permanently empty the trash?')) {
                            try {
                              await opsApi.emptyTrash();
                              showToast({ message: 'Trash emptied successfully' });
                              loadDir(TRASH_PATH);
                            } catch (e: any) {
                              showToast({ message: `Failed to empty trash: ${e}` });
                            }
                          }
                        }}
                        style={{ fontSize: 13, padding: '6px 12px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                      >
                        Empty Trash
                      </button>
                    )}
                  </div>
                )}

                {loading && (
                  <div className="file-grid" style={{ padding: 16 }}>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="skeleton skeleton--card" />
                    ))}
                  </div>
                )}

                {!loading && listing?.error && (
                  <div className="empty-state">
                    <div className="empty-state__icon">Access issue</div>
                    <div className="empty-state__title">Could not open this location</div>
                    <div className="empty-state__body">{listing.error}</div>
                    <button className="btn btn--secondary" onClick={handleRefresh}>Try again</button>
                  </div>
                )}

                {!loading && !listing?.error && (
                  <>
                    {activeTab.viewMode === 'grid' && (
                      <FileGrid
                        entries={entries}
                        renamingId={renamingId}
                        onRenameCommit={doRename}
                        onRenameCancel={() => setRenamingId(null)}
                        onOpen={handleOpen}
                        onContextMenu={handleContextMenu}
                        onDropItems={handleDropItems}
                        onHoverOpenStart={beginHoverOpen}
                        onHoverOpenMove={handleHoverOpenMove}
                        onHoverOpenCancel={cancelHoverOpen}
                      />
                    )}
                    {activeTab.viewMode !== 'grid' && (
                      <FileList
                        entries={entries}
                        renamingId={renamingId}
                        onRenameCommit={doRename}
                        onRenameCancel={() => setRenamingId(null)}
                        onOpen={handleOpen}
                        onContextMenu={handleContextMenu}
                        onDropItems={handleDropItems}
                        onHoverOpenStart={beginHoverOpen}
                        onHoverOpenMove={handleHoverOpenMove}
                        onHoverOpenCancel={cancelHoverOpen}
                      />
                    )}
                  </>
                )}
              </>
            );
          })()}
          {dragStyles && <div style={dragStyles} />}
        </div>


        {contextMenu.visible && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entries={contextMenu.isBackground ? [] : contextMenu.targetEntries}
            isBackground={contextMenu.isBackground}
            currentPath={activeTab.path}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onDelete={handleDelete}
            onRename={handleRename}
            onNewFolder={handleNewFolder}
            onNewFile={handleNewFile}
            onProperties={() => {
              if (selectedEntries.length === 1) {
                dispatch({ type: 'SET_DIALOG', dialog: { kind: 'properties', entry: selectedEntries[0] } });
              }
            }}
            onShare={(entry) => {
              dispatch({ type: 'SET_DIALOG', dialog: { kind: 'share', entry } });
            }}
            onOpen={handleOpen}
            onOpenWith={(entry) => {
                opsApi.openItemWith(entry.path).catch(e => showToast({ message: `Open With failed: ${e}` }));
            }}
            onRefresh={handleRefresh}
            onOpenTerminal={handleOpenTerminal}
          />
        )}

        {hoverOpenCue && (
          <div
            className="hover-open-cue"
            style={{
              left: hoverOpenCue.x + 12,
              top: hoverOpenCue.y - 24,
              ['--hover-open-delay' as string]: `${state.settings.hoverOpenDelay}ms`,
            }}
            aria-label={`Opening ${hoverOpenCue.name}`}
          >
            <svg viewBox="0 0 24 24" className="hover-open-progress">
              <circle cx="12" cy="12" r="10" className="hover-open-bg" />
              <circle cx="12" cy="12" r="10" className="hover-open-fg" />
            </svg>
          </div>
        )}
      </div>

      <StatusBar itemCount={entries.length} totalSize={totalSelectedSize} progress={progress} />
    </>
  );
}
