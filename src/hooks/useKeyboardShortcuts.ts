import { useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import type { FileEntry } from '../types';

interface KeyboardShortcutsProps {
  selectedEntries: FileEntry[];
  currentPath: string;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: (permanent: boolean) => void;
  onRename: () => void;
  onNewFolder: () => void;
  onSelectAll: () => void;
  onRefresh: () => void;
  onOpenSpotlight: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function useKeyboardShortcuts({
  selectedEntries,
  currentPath,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onRename,
  onNewFolder,
  onSelectAll,
  onRefresh,
  onOpenSpotlight,
  onUndo,
  onRedo,
}: KeyboardShortcutsProps) {
  const { dispatch, navigateBack, navigateForward, navigateUp, state } = useApp();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip if typing in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (target.contentEditable === 'true') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;

    // ── Navigation
    if (alt && e.key === 'ArrowLeft')  { e.preventDefault(); navigateBack(); return; }
    if (alt && e.key === 'ArrowRight') { e.preventDefault(); navigateForward(); return; }
    if (alt && e.key === 'ArrowUp')    { e.preventDefault(); navigateUp(); return; }
    if (e.key === 'Backspace' && !ctrl) { e.preventDefault(); navigateBack(); return; }

    // ── Tabs
    if (ctrl && e.key === 't') { e.preventDefault(); dispatch({ type: 'NEW_TAB' }); return; }
    if (ctrl && e.key === 'w') { e.preventDefault(); dispatch({ type: 'CLOSE_TAB', id: state.activeTabId }); return; }

    // ── File operations
    if (ctrl && e.key === 'c') { e.preventDefault(); onCopy(); return; }
    if (ctrl && e.key === 'x') { e.preventDefault(); onCut(); return; }
    if (ctrl && e.key === 'v') { e.preventDefault(); onPaste(); return; }
    if (ctrl && e.key === 'a') { e.preventDefault(); onSelectAll(); return; }
    if (ctrl && shift && e.key === 'N') { e.preventDefault(); onNewFolder(); return; }

    // ── Rename
    if (e.key === 'F2' && selectedEntries.length === 1) { e.preventDefault(); onRename(); return; }

    // ── Delete
    if (e.key === 'Delete' && !shift) { e.preventDefault(); onDelete(false); return; }
    if (e.key === 'Delete' && shift)  { e.preventDefault(); onDelete(true);  return; }

    // ── Refresh
    if (e.key === 'F5') { e.preventDefault(); onRefresh(); return; }

    // ── Focus address bar
    if (ctrl && e.key === 'l') {
      e.preventDefault();
      document.querySelector<HTMLElement>('.breadcrumbs')?.click();
      return;
    }

    // ── Focus search
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      document.querySelector<HTMLElement>('#search-input')?.focus();
      return;
    }

    // ── Spotlight
    if (ctrl && e.key === ' ') {
      e.preventDefault();
      onOpenSpotlight();
      return;
    }

    // ── Undo
    if (ctrl && shift && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      onRedo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      onUndo();
      return;
    }

    // ── Preview toggle
    if (e.key === ' ' && selectedEntries.length > 0) {
      e.preventDefault();
      dispatch({ type: 'TOGGLE_PREVIEW' });
      return;
    }

    // ── Escape: close context menu, clear search
    if (e.key === 'Escape') {
      dispatch({ type: 'HIDE_CONTEXT_MENU' });
      dispatch({ type: 'SET_DIALOG', dialog: { kind: 'none' } });
      dispatch({ type: 'SET_SEARCH_QUERY', query: '' });
      dispatch({ type: 'SET_IS_SEARCHING', value: false });
      return;
    }
  }, [dispatch, navigateBack, navigateForward, navigateUp, selectedEntries, state.activeTabId,
      onCopy, onCut, onPaste, onDelete, onRename, onNewFolder, onSelectAll, onRefresh, onOpenSpotlight, onUndo, onRedo]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
