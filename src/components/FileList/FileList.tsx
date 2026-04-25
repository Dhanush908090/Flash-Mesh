import React, { useCallback, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { formatFileSize, formatDate } from '../../api/tauri';
import { FileIcon } from '../FileIcon/FileIcon';
import { getDisplayName } from '../../utils/fileDisplay';
import type { FileEntry, SortField } from '../../types';

function SortIcon({ field, currentField, direction }: { field: SortField; currentField: SortField; direction: 'asc' | 'desc' }) {
  if (field !== currentField) return null;
  return direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

interface FileListProps {
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

export function FileList({
  entries, renamingId, onRenameCommit, onRenameCancel, onOpen, onContextMenu, onDropItems,
  onHoverOpenStart, onHoverOpenMove, onHoverOpenCancel,
}: FileListProps) {
  const { activeTab, dispatch, state } = useApp();
  const { sortConfig } = activeTab;
  const lastClickId = useRef<string | null>(null);


  const cycleSort = (field: SortField) => {
    if (sortConfig.field === field) {
      dispatch({ type: 'SET_SORT', config: { field, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' } });
    } else {
      dispatch({ type: 'SET_SORT', config: { field, direction: 'asc' } });
    }
  };

  const handleClick = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.stopPropagation();

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

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (Math.sqrt(dx*dx + dy*dy) > 10) {
      cancelTouchMenu();
    }
  };

  const cancelTouchMenu = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    touchStartPos.current = null;
  };

  const cutPaths = state.clipboard.operation === 'cut'
    ? new Set(state.clipboard.items.map(i => i.id))
    : new Set<string>();

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">Folder is empty</div>
        <div className="empty-state__title">No files found</div>
      </div>
    );
  }

  return (
    <div
      className="file-list"
      onDragOver={e => e.preventDefault()}
      onTouchStart={e => {
        if ((e.target as Element).classList.contains('file-list')) {
          beginTouchMenu(e);
        }
      }}
      onTouchMove={handleTouchMove}
      onTouchEnd={cancelTouchMenu}
      onTouchCancel={cancelTouchMenu}
      onDrop={e => {
        const sourceId = e.dataTransfer.getData('text/plain');
        if (!sourceId) return;
        const copy = e.ctrlKey || e.metaKey;
        const sourceIds = activeTab.selection.has(sourceId) ? [...activeTab.selection] : [sourceId];
        onDropItems(activeTab.path, sourceIds, copy);
      }}
    >
      <div className="file-list__header">
        <div className="file-list__header-cell" onClick={() => cycleSort('name')}>
          Name <SortIcon field="name" currentField={sortConfig.field} direction={sortConfig.direction} />
        </div>
        <div className="file-list__header-cell" onClick={() => cycleSort('size')}>
          Size <SortIcon field="size" currentField={sortConfig.field} direction={sortConfig.direction} />
        </div>
        <div className="file-list__header-cell" onClick={() => cycleSort('modified')}>
          Modified <SortIcon field="modified" currentField={sortConfig.field} direction={sortConfig.direction} />
        </div>
        <div className="file-list__header-cell" onClick={() => cycleSort('type')}>
          Type <SortIcon field="type" currentField={sortConfig.field} direction={sortConfig.direction} />
        </div>
      </div>
      {entries.map(entry => {
        const isSelected = activeTab.selection.has(entry.id);
        const isCut = cutPaths.has(entry.id);
        const isRenaming = renamingId === entry.id;

        return (
          <div
            key={entry.id}
            className={`file-row${isSelected ? ' file-row--selected' : ''}${isCut ? ' file-row--cut' : ''}${entry.isDir ? ' file-row--folder' : ' file-row--file'}`}
            onClick={e => handleClick(e, entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              if (!isSelected) dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
              const selectedEntries = isSelected
                ? entries.filter(en => activeTab.selection.has(en.id))
                : [entry];
              onContextMenu(e, selectedEntries, false);
            }}
            data-id={entry.id}
            draggable
            onMouseEnter={e => onHoverOpenStart(entry, e)}
            onMouseMove={onHoverOpenMove}
            onMouseLeave={onHoverOpenCancel}
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'copyMove';
              e.dataTransfer.setData('text/plain', entry.id);
            }}
            onDragOver={e => {
              if (entry.isDir) e.preventDefault();
            }}
            onTouchStart={e => beginTouchMenu(e, entry)}
            onTouchMove={handleTouchMove}
            onTouchEnd={cancelTouchMenu}
            onTouchCancel={cancelTouchMenu}
            onDrop={e => {
              if (!entry.isDir) return;
              e.preventDefault();
              e.stopPropagation();
              const sourceId = e.dataTransfer.getData('text/plain');
              if (!sourceId) return;
              const copy = e.ctrlKey || e.metaKey;
              const sourceIds = activeTab.selection.has(sourceId) ? [...activeTab.selection] : [sourceId];
              onDropItems(entry.path, sourceIds, copy);
            }}
          >
            <div className="file-row__name">
              <span className="file-row__icon"><FileIcon entry={entry} size={16} /></span>
              {isRenaming ? (
                <input
                  className="file-rename-input"
                  defaultValue={entry.name}
                  autoFocus
                  onBlur={e => {
                    const n = e.target.value.trim();
                    if (n && n !== entry.name) onRenameCommit(entry, n);
                    else onRenameCancel();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      const n = (e.target as HTMLInputElement).value.trim();
                      if (n && n !== entry.name) onRenameCommit(entry, n);
                      else onRenameCancel();
                    }
                    if (e.key === 'Escape') { e.stopPropagation(); onRenameCancel(); }
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="file-row__name-text">{getDisplayName(entry, state.settings.showFileExtensions)}</span>
              )}
            </div>
            <div className="file-row__size">{formatFileSize(entry.size)}</div>
            <div className="file-row__date">{formatDate(entry.modified)}</div>
            <div className="file-row__type">{entry.isDir ? 'Folder' : (entry.extension?.toUpperCase() || 'File')}</div>
          </div>
        );
      })}
    </div>
  );
}
