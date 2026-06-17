import React, { useEffect, useRef } from 'react';
import {
  Copy, Scissors, Clipboard, Trash2, Pencil, FolderPlus, FilePlus,
  Info, ExternalLink, RotateCcw, Grid3X3, List, TerminalSquare
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { FileEntry } from '../../types';
import { RadialContextMenu } from './RadialContextMenu';

interface MenuItem {
  kind: 'item';
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

interface Separator { kind: 'separator' }
type MenuEntry = MenuItem | Separator;

interface ContextMenuProps {
  x: number;
  y: number;
  entries: FileEntry[];
  isBackground: boolean;
  currentPath: string;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: (permanent: boolean) => void;
  onRename: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onProperties: () => void;
  onOpen: (entry: FileEntry) => void;
  onOpenWith: (entry: FileEntry) => void;
  onRefresh: () => void;
  onOpenTerminal: () => void;
}

export function ContextMenu({
  x, y, entries, isBackground,
  onCopy, onCut, onPaste, onDelete, onRename,
  onNewFolder, onNewFile, onProperties, onOpen, onOpenWith, onRefresh, onOpenTerminal,
}: ContextMenuProps) {
  const { state, dispatch } = useApp();
  const menuRef = useRef<HTMLDivElement>(null);
  const hasClipboard = state.clipboard.operation !== null && state.clipboard.items.length > 0;
  const hasSelection = entries.length > 0;
  const multiSelect = entries.length > 1;
  const { platform } = state;

  // Auto-position to keep menu in viewport
  const style: React.CSSProperties = { left: x, top: y };
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) menuRef.current.style.left = `${x - rect.width}px`;
    if (rect.bottom > vh) menuRef.current.style.top = `${y - rect.height}px`;
  }, [x, y]);

  // Build menu items based on context
  const items: MenuEntry[] = [];

  const isFile = !isBackground && entries.length === 1 && !entries[0].isDir;

  if (!isBackground && hasSelection) {
    items.push({ kind: 'item', id: 'open', label: 'Open', icon: <ExternalLink size={14} />, action: () => onOpen(entries[0]) });
    
    if (isFile && platform.supportsOpenWith) {
      items.push({ kind: 'item', id: 'open-with', label: 'Open With...', icon: <ExternalLink size={14} />, action: () => onOpenWith(entries[0]) });
    }

    if (!multiSelect) {
      items.push({ kind: 'item', id: 'rename', label: 'Rename', icon: <Pencil size={14} />, shortcut: 'F2', action: onRename });
    }

    items.push({ kind: 'separator' });
    items.push({ kind: 'item', id: 'copy', label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C', action: onCopy });
    items.push({ kind: 'item', id: 'cut', label: 'Cut', icon: <Scissors size={14} />, shortcut: 'Ctrl+X', action: onCut });

    if (hasClipboard) {
      items.push({ kind: 'item', id: 'paste', label: 'Paste', icon: <Clipboard size={14} />, shortcut: 'Ctrl+V', action: onPaste });
    }

    items.push({ kind: 'separator' });
    if (platform.supportsTrash) {
      items.push({ kind: 'item', id: 'delete', label: 'Move to Trash', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, action: () => onDelete(false) });
    }
    items.push({ kind: 'item', id: 'perm-delete', label: 'Delete Permanently', icon: <Trash2 size={14} />, shortcut: 'Shift+Del', danger: true, action: () => onDelete(true) });
    if (platform.supportsTerminal) {
      items.push({ kind: 'separator' });
      items.push({ kind: 'item', id: 'terminal', label: 'Open in Terminal', icon: <TerminalSquare size={14} />, action: onOpenTerminal });
    }
    items.push({ kind: 'separator' });
    items.push({ kind: 'item', id: 'properties', label: 'Properties', icon: <Info size={14} />, action: onProperties });
  } else {
    // Background (empty space) menu
    items.push({ kind: 'item', id: 'new-folder', label: 'New Folder', icon: <FolderPlus size={14} />, shortcut: 'Ctrl+Shift+N', action: onNewFolder });
    items.push({ kind: 'item', id: 'new-file', label: 'New File', icon: <FilePlus size={14} />, action: onNewFile });
    items.push({ kind: 'separator' });
    if (hasClipboard) {
      items.push({ kind: 'item', id: 'paste', label: `Paste (${state.clipboard.items.length})`, icon: <Clipboard size={14} />, shortcut: 'Ctrl+V', action: onPaste });
      items.push({ kind: 'separator' });
    }
    items.push({
      kind: 'item', id: 'view-grid', label: 'View: Grid', icon: <Grid3X3 size={14} />,
      action: () => dispatch({ type: 'SET_VIEW_MODE', mode: 'grid' })
    });
    items.push({
      kind: 'item', id: 'view-list', label: 'View: List', icon: <List size={14} />,
      action: () => dispatch({ type: 'SET_VIEW_MODE', mode: 'list' })
    });
    items.push({ kind: 'separator' });
    items.push({ kind: 'item', id: 'refresh', label: 'Refresh', icon: <RotateCcw size={14} />, shortcut: 'F5', action: onRefresh });
    if (platform.supportsTerminal) {
      items.push({ kind: 'item', id: 'terminal', label: 'Open Terminal Here', icon: <TerminalSquare size={14} />, action: onOpenTerminal });
    }
  }

  // ── Radial Omnitrix Mode ────────────────────────────────────────────────
  if (state.settings.omnitrixMenu) {
    const radialItems = items
      .filter((item): item is MenuItem => item.kind === 'item')
      .map(item => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        danger: item.danger,
        disabled: item.disabled,
        action: item.action,
      }));

    return (
      <RadialContextMenu
        x={x}
        y={y}
        items={radialItems}
        onClose={() => dispatch({ type: 'HIDE_CONTEXT_MENU' })}
      />
    );
  }

  // ── Standard List Menu ──────────────────────────────────────────────────
  return (
    <div ref={menuRef} className="context-menu" style={style}>
      {items.map((item, i) =>
        item.kind === 'separator'
          ? <div key={`sep-${i}`} className="context-menu__separator" />
          : (
            <button
              key={item.id}
              className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => { item.action(); dispatch({ type: 'HIDE_CONTEXT_MENU' }); }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.shortcut && <span className="context-menu__item__shortcut">{item.shortcut}</span>}
            </button>
          )
      )}
    </div>
  );
}
