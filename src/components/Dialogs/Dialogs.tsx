import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { File, Folder } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { FileEntry } from '../../types';
import { ShareModal } from './ShareModal';

// ─── Rename Dialog ────────────────────────────────────────────────────────────

interface RenameDialogProps {
  entry: FileEntry;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

export function RenameDialog({ entry, onConfirm, onCancel }: RenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select name without extension
    const dot = entry.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry.name]);

  const commit = () => {
    const val = inputRef.current?.value.trim() || '';
    if (val && val !== entry.name) onConfirm(val);
    else onCancel();
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">Rename</div>
        <input
          ref={inputRef}
          className="dialog__input"
          defaultValue={entry.name}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
        />
        <div className="dialog__actions">
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={commit}>Rename</button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

interface DeleteDialogProps {
  entries: FileEntry[];
  permanent: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({ entries, permanent, onConfirm, onCancel }: DeleteDialogProps) {
  const label = entries.length === 1
    ? `"${entries[0].name}"`
    : `${entries.length} items`;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">{permanent ? 'Delete Permanently' : 'Move to Trash'}</div>
        <div className="dialog__body">
          {permanent
            ? `Are you sure you want to permanently delete ${label}? This cannot be undone.`
            : `Move ${label} to the Trash?`}
        </div>
        <div className="dialog__actions">
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn--danger" onClick={onConfirm} autoFocus>
            {permanent ? 'Delete' : 'Move to Trash'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Folder Dialog ────────────────────────────────────────────────────────

interface NewFolderDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewFolderDialog({ onConfirm, onCancel }: NewFolderDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    const val = inputRef.current?.value.trim() || '';
    if (val) onConfirm(val);
    else onCancel();
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">New Folder</div>
        <input
          ref={inputRef}
          className="dialog__input"
          placeholder="Folder name"
          defaultValue="New Folder"
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
        />
        <div className="dialog__actions">
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={commit}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ─── Properties Dialog ────────────────────────────────────────────────────────

interface PropertiesDialogProps {
  entry: FileEntry;
  onClose: () => void;
}

function row(label: string, value: string) {
  return (
    <div className="preview-panel__meta-row" key={label}>
      <span className="preview-panel__meta-label">{label}</span>
      <span className="preview-panel__meta-value">{value}</span>
    </div>
  );
}

export function PropertiesDialog({ entry, onClose }: PropertiesDialogProps) {
  function fmtSize(n: number | null) {
    if (n === null) return '—';
    if (n < 1024) return `${n} bytes`;
    if (n < 1048576) return `${(n/1024).toFixed(1)} KB (${n.toLocaleString()} bytes)`;
    if (n < 1073741824) return `${(n/1048576).toFixed(2)} MB (${n.toLocaleString()} bytes)`;
    return `${(n/1073741824).toFixed(3)} GB (${n.toLocaleString()} bytes)`;
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="dialog__title-icon">
            {entry.isDir ? <Folder size={22} /> : <File size={22} />}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
        </div>
        <div className="preview-panel__meta" style={{ margin: '16px 0' }}>
          {row('Type', entry.isDir ? 'Folder' : (entry.extension?.toUpperCase() + ' File' || 'File'))}
          {row('Location', entry.path.substring(0, entry.path.lastIndexOf('/')) || '/')}
          {!entry.isDir && row('Size', fmtSize(entry.size))}
          {row('Modified', entry.modified || '—')}
          {row('Created', entry.created || '—')}
          {row('Hidden', entry.isHidden ? 'Yes' : 'No')}
          {row('Symlink', entry.isSymlink ? 'Yes' : 'No')}
        </div>
        <div className="dialog__actions">
          <button className="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
// ─── Drag & Drop Dialog ──────────────────────────────────────────────────────
interface DragDropDialogProps {
  sourcePaths: string[];
  destination: string;
  onConfirm: (operation: 'move' | 'copy') => void;
  onCancel: () => void;
}

export function DragDropDialog({ sourcePaths, destination, onConfirm, onCancel }: DragDropDialogProps) {
  const count = sourcePaths.length;
  const label = count === 1 ? '1 item' : `${count} items`;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">Move or Copy?</div>
        <div className="dialog__body">
          What would you like to do with {label}?
          <div style={{ marginTop: 12, opacity: 0.6, fontSize: 12, fontStyle: 'italic' }}>
            To: {destination}
          </div>
        </div>
        <div className="dialog__actions">
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--secondary" onClick={() => onConfirm('copy')}>Copy</button>
            <button className="btn btn--primary" onClick={() => onConfirm('move')}>Move</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dialog Dispatcher ────────────────────────────────────────────────────────

interface DialogManagerProps {
  onRenameConfirm: (entry: FileEntry, newName: string) => void;
  onDeleteConfirm: (entries: FileEntry[], permanent: boolean) => void;
  onNewFolderConfirm: (name: string) => void;
  onDragDropConfirm: (sourcePaths: string[], destination: string, operation: 'move' | 'copy') => void;
}

export function DialogManager({ 
  onRenameConfirm, 
  onDeleteConfirm, 
  onNewFolderConfirm, 
  onDragDropConfirm 
}: DialogManagerProps) {
  const { state, dispatch } = useApp();
  const { dialog } = state;

  const close = () => dispatch({ type: 'SET_DIALOG', dialog: { kind: 'none' } });

  if (dialog.kind === 'none') return null;

  return createPortal(
    <div className="dialog-overlay-root">
      {dialog.kind === 'rename' && (
        <RenameDialog 
          entry={dialog.entry} 
          onConfirm={n => { 
            const entry = dialog.entry;
            close(); 
            setTimeout(() => onRenameConfirm(entry, n), 100); 
          }} 
          onCancel={close} 
        />
      )}
      {dialog.kind === 'delete' && (
        <DeleteDialog 
          entries={dialog.entries} 
          permanent={dialog.permanent} 
          onConfirm={() => { 
            const entries = dialog.entries;
            const perm = dialog.permanent;
            close(); 
            setTimeout(() => onDeleteConfirm(entries, perm), 100); 
          }} 
          onCancel={close} 
        />
      )}
      {dialog.kind === 'newFolder' && (
        <NewFolderDialog 
          onConfirm={n => { 
            close(); 
            setTimeout(() => onNewFolderConfirm(n), 100); 
          }} 
          onCancel={close} 
        />
      )}
      {dialog.kind === 'properties' && <PropertiesDialog entry={dialog.entry} onClose={close} />}
      {dialog.kind === 'share' && <ShareModal entry={dialog.entry} onClose={close} />}
      {dialog.kind === 'dragDrop' && (
        <DragDropDialog
          sourcePaths={dialog.sourcePaths}
          destination={dialog.destination}
          onConfirm={op => {
            const paths = dialog.sourcePaths;
            const dest  = dialog.destination;
            close();
            // Use 100ms timeout to be absolutely sure the DOM has updated and browser has breathed
            setTimeout(() => {
              onDragDropConfirm(paths, dest, op);
            }, 100);
          }}
          onCancel={close}
        />
      )}
    </div>,
    document.body
  );
}
