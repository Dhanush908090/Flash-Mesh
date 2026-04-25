import React, { useRef, useCallback, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { FileIcon } from '../FileIcon/FileIcon';
import { getDisplayName } from '../../utils/fileDisplay';
import type { FileEntry } from '../../types';

interface FileCardProps {
  entry: FileEntry;
  isSelected: boolean;
  isCut: boolean;
  isRenaming: boolean;
  showExtensions: boolean;
  onRenameCommit: (newName: string) => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchMenu: (e: React.TouchEvent) => void;
  onTouchMenuCancel: () => void;
  onDrop: (e: React.DragEvent, target: FileEntry) => void;
  onHoverOpenStart: (entry: FileEntry, e: React.MouseEvent) => void;
  onHoverOpenMove: (e: React.MouseEvent) => void;
  onHoverOpenCancel: () => void;
}

function FileCard({
  entry, isSelected, isCut, isRenaming, showExtensions,
  onRenameCommit, onRenameCancel,
  onClick, onDoubleClick, onContextMenu, onTouchMenu, onTouchMenuCancel, onDrop,
  onHoverOpenStart, onHoverOpenMove, onHoverOpenCancel,
}: FileCardProps) {
  const [renameVal, setRenameVal] = useState(entry.name);

  const commitRename = () => {
    const n = renameVal.trim();
    if (n && n !== entry.name) onRenameCommit(n);
    else onRenameCancel();
  };

  return (
    <div
      className={`file-card${isSelected ? ' file-card--selected' : ''}${isCut ? ' file-card--cut' : ''}${isRenaming ? ' file-card--renaming' : ''}${entry.isDir ? ' file-card--folder' : ' file-card--file'}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchMenu}
      onTouchMove={onTouchMenuCancel}
      onTouchEnd={onTouchMenuCancel}
      onTouchCancel={onTouchMenuCancel}
      data-id={entry.id}
      title={entry.name}
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', entry.id);
      }}
      onDragOver={e => {
        if (entry.isDir) e.preventDefault();
      }}
      onDrop={e => onDrop(e, entry)}
      onMouseEnter={e => onHoverOpenStart(entry, e)}
      onMouseMove={onHoverOpenMove}
      onMouseLeave={onHoverOpenCancel}
      role="button"
      aria-label={entry.name}
      tabIndex={-1}
    >
      <div className="file-card__check">✓</div>
      <div className="file-card__icon">
        <FileIcon entry={entry} size={32} />
      </div>
      {isRenaming ? (
        <input
          className="file-rename-input"
          value={renameVal}
          autoFocus
          onChange={e => setRenameVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.stopPropagation(); commitRename(); }
            if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel(); }
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="file-card__name">{getDisplayName(entry, showExtensions)}</span>
      )}
    </div>
  );
}

interface FileGridProps {
  entries: FileEntry[];
  renamingId: string | null;
  onRenameCommit: (entry: FileEntry, newName: string) => void;
  onRenameCancel: () => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entries: FileEntry[], isBackground: boolean) => void;
  onDropItems: (targetDir: string, sourceIds: string[], copy: boolean) => void;
  onHoverOpenStart: (entry: FileEntry, e: React.MouseEvent) => void;
  onHoverOpenMove: (e: React.MouseEvent) => void;
  onHoverOpenCancel: () => void;
}

export function FileGrid({
  entries, renamingId, onRenameCommit, onRenameCancel, onOpen, onContextMenu, onDropItems,
  onHoverOpenStart, onHoverOpenMove, onHoverOpenCancel,
}: FileGridProps) {
  const { activeTab, dispatch, state } = useApp();
  const lastClickId = useRef<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const handleClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.stopPropagation();
    lastClickId.current = entry.id;

    const isMobile = state.platform.isMobile || window.matchMedia?.('(pointer: coarse)').matches;
    const hasSelection = activeTab.selection.size > 0;

    if (isMobile && hasSelection) {
      dispatch({ type: 'TOGGLE_SELECTION', id: entry.id });
    } else if (e.ctrlKey || e.metaKey) {
      dispatch({ type: 'TOGGLE_SELECTION', id: entry.id });
    } else if (e.shiftKey) {
      const ids = entries.map(item => item.id);
      const pivotId = activeTab.selectionPivot || (ids.length > 0 ? ids[0] : null);
      if (!pivotId) {
        dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
        return;
      }
      const fromIdx = ids.indexOf(pivotId);
      const toIdx = ids.indexOf(entry.id);
      if (fromIdx === -1) {
        dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
        return;
      }
      const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      dispatch({ type: 'SET_SELECTION_RANGE', ids: new Set(ids.slice(start, end + 1)) });
    } else {
      dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
    }
  }, [activeTab.selection, activeTab.selectionPivot, dispatch, entries, state.platform.isMobile]);

  const cutPaths = state.clipboard.operation === 'cut'
    ? new Set(state.clipboard.items.map(i => i.id))
    : new Set<string>();

  const handleDropOnEntry = (e: React.DragEvent, target: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    if (!target.isDir) return;
    const sourceId = e.dataTransfer.getData('text/plain');
    if (!sourceId) return;
    const copy = e.ctrlKey || e.metaKey;
    const sourceIds = activeTab.selection.has(sourceId) ? [...activeTab.selection] : [sourceId];
    onDropItems(target.path, sourceIds, copy);
  };

  const touchStartPos = useRef<{ x: number, y: number } | null>(null);

  const beginTouchMenu = (e: React.TouchEvent, entry?: FileEntry) => {
    if (!state.platform.isMobile && !window.matchMedia?.('(pointer: coarse)').matches) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    longPressTimer.current = setTimeout(() => {
      if (entry) {
        dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
        onContextMenu(
          {
            preventDefault: () => {},
            stopPropagation: () => {},
            clientX: touch.clientX,
            clientY: touch.clientY,
          } as React.MouseEvent,
          [entry],
          false,
        );
      } else {
        // Background long press
        onContextMenu(
          {
            preventDefault: () => {},
            stopPropagation: () => {},
            clientX: touch.clientX,
            clientY: touch.clientY,
          } as React.MouseEvent,
          [],
          true,
        );
      }
      longPressTimer.current = null;
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current || !longPressTimer.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPos.current.x;
    const dy = touch.clientY - touchStartPos.current.y;
    // Allow 10px of movement before cancelling long press
    if (Math.sqrt(dx*dx + dy*dy) > 10) {
      cancelTouchMenu();
    }
  };

  const cancelTouchMenu = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    touchStartPos.current = null;
  };

  if (entries.length === 0) {
    return (
      <div className="empty-state" role="status" aria-live="polite">
        <div className="empty-state__icon">Folder is empty</div>
        <div className="empty-state__title">No files yet</div>
        <div className="empty-state__body">Use right click to add a new file or folder.</div>
      </div>
    );
  }

  return (
    <div
      className="file-grid"
      onContextMenu={e => {
        if ((e.target as Element).classList.contains('file-grid')) {
          onContextMenu(e, [], true);
        }
      }}
      onTouchStart={e => {
        if ((e.target as Element).classList.contains('file-grid')) {
          beginTouchMenu(e);
        }
      }}
      onTouchMove={handleTouchMove}
      onTouchEnd={cancelTouchMenu}
      onTouchCancel={cancelTouchMenu}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        const sourceId = e.dataTransfer.getData('text/plain');
        if (!sourceId) return;
        const copy = e.ctrlKey || e.metaKey;
        const sourceIds = activeTab.selection.has(sourceId) ? [...activeTab.selection] : [sourceId];
        onDropItems(activeTab.path, sourceIds, copy);
      }}
    >
      {entries.map(entry => (
        <FileCard
          key={entry.id}
          entry={entry}
          isSelected={activeTab.selection.has(entry.id)}
          isCut={cutPaths.has(entry.id)}
          isRenaming={renamingId === entry.id}
          showExtensions={state.settings.showFileExtensions}
          onRenameCommit={n => onRenameCommit(entry, n)}
          onRenameCancel={onRenameCancel}
          onClick={e => handleClick(e, entry)}
          onDoubleClick={() => onOpen(entry)}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            if (!activeTab.selection.has(entry.id)) {
              dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
            }
            const selectedEntries = activeTab.selection.has(entry.id)
              ? entries.filter(en => activeTab.selection.has(en.id))
              : [entry];
            onContextMenu(e, selectedEntries, false);
          }}
          onTouchMenu={e => beginTouchMenu(e, entry)}
          onTouchMove={handleTouchMove}
          onTouchEnd={cancelTouchMenu}
          onTouchMenuCancel={cancelTouchMenu}
          onDrop={handleDropOnEntry}
          onHoverOpenStart={onHoverOpenStart}
          onHoverOpenMove={onHoverOpenMove}
          onHoverOpenCancel={onHoverOpenCancel}
        />
      ))}
    </div>
  );
}
