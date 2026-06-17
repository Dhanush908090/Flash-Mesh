import React from 'react';
import { Clipboard } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { ProgressEvent } from '../../api/tauri';

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface StatusBarProps {
  itemCount: number;
  totalSize: number;
  progress: ProgressEvent | null;
}

export function StatusBar({ itemCount, totalSize, progress }: StatusBarProps) {
  const { activeTab, state } = useApp();
  const selCount = activeTab.selection.size;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        {selCount > 0
          ? <span>{selCount} item{selCount !== 1 ? 's' : ''} selected</span>
          : <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
        }
        {selCount > 0 && totalSize > 0 && (
          <span className="status-bar__size">{formatSize(totalSize)}</span>
        )}
      </div>
      <div className="status-bar__right">
        {progress && (
          <span className="status-bar__progress">
            {progress.label} ({Math.round(progress.percent)}%)
          </span>
        )}
        {state.clipboard.operation && (
          <span className="status-bar__clipboard">
            <Clipboard size={12} />
            {state.clipboard.items.length} item{state.clipboard.items.length !== 1 ? 's' : ''} {state.clipboard.operation === 'cut' ? 'cut' : 'copied'}
          </span>
        )}
        <span className="status-bar__path">{activeTab.path}</span>
      </div>
    </div>
  );
}
