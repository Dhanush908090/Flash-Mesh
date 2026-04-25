import React, { useState } from 'react';
import { FileIcon } from '../FileIcon/FileIcon';
import { getDisplayName } from '../../utils/fileDisplay';
import type { FileEntry } from '../../types';

export interface FileCardProps {
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
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchMenuCancel: () => void;
  onDrop: (e: React.DragEvent, target: FileEntry) => void;
  onHoverOpenStart: (entry: FileEntry, e: React.MouseEvent) => void;
  onHoverOpenMove: (e: React.MouseEvent) => void;
  onHoverOpenCancel: () => void;
}

export function FileCard({
  entry, isSelected, isCut, isRenaming, showExtensions,
  onRenameCommit, onRenameCancel,
  onClick, onDoubleClick, onContextMenu, onTouchMenu, onTouchMove, onTouchEnd, onTouchMenuCancel, onDrop,
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
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
