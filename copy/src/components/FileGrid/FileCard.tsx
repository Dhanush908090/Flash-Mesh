import React, { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FileIcon } from '../FileIcon/FileIcon';
import { getDisplayName } from '../../utils/fileDisplay';
import type { FileEntry } from '../../types';

// File extensions that we can show as inline thumbnails
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'svg', 'ico']);

function isImageFile(entry: FileEntry): boolean {
  if (entry.isDir) return false;
  const ext = entry.extension?.toLowerCase();
  return !!(ext && IMAGE_EXTS.has(ext));
}

function toThumbnailSrc(path: string): string {
  try { return convertFileSrc(path); }
  catch { return ''; }
}

// ── Thumbnail sub-component ──────────────────────────────────────────────────
function ImageThumbnail({ entry }: { entry: FileEntry }) {
  const [src, setSrc] = useState('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setSrc(toThumbnailSrc(entry.path));
    setErrored(false);
  }, [entry.path]);

  if (!src || errored) {
    return <FileIcon entry={entry} size={36} />;
  }

  return (
    <img
      src={src}
      alt={entry.name}
      className="file-card__thumbnail"
      onError={() => setErrored(true)}
      draggable={false}
    />
  );
}

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
  const showThumbnail = isImageFile(entry);

  const commitRename = () => {
    const n = renameVal.trim();
    if (n && n !== entry.name) onRenameCommit(n);
    else onRenameCancel();
  };

  return (
    <div
      className={[
        'file-card',
        isSelected ? 'file-card--selected' : '',
        isCut ? 'file-card--cut' : '',
        isRenaming ? 'file-card--renaming' : '',
        entry.isDir ? 'file-card--folder' : 'file-card--file',
        showThumbnail ? 'file-card--image' : '',
      ].filter(Boolean).join(' ')}
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
      onDragOver={e => { if (entry.isDir) e.preventDefault(); }}
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
        {showThumbnail
          ? <ImageThumbnail entry={entry} />
          : <FileIcon entry={entry} size={36} />
        }
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
