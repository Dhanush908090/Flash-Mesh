import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getFileIcon, formatFileSize, formatDate, opsApi } from '../../api/tauri';
import type { FileEntry } from '../../types';

interface PreviewPanelProps {
  entry: FileEntry | null;
  onClose: () => void;
}

export function PreviewPanel({ entry, onClose }: PreviewPanelProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTextContent(null);
    if (!entry || entry.isDir) return;

    const ext = (entry.extension || '').toLowerCase();
    const isText = ['txt','md','rs','ts','tsx','js','jsx','json','toml','yaml','yml','sh','css','html','py','go','cpp','c','h'].includes(ext);

    if (isText) {
      setLoading(true);
      opsApi.readTextFile(entry.path, 32768)
        .then(t => setTextContent(t))
        .catch(() => setTextContent(null))
        .finally(() => setLoading(false));
    }
  }, [entry]);

  if (!entry) return null;

  const ext = (entry.extension || '').toLowerCase();
  const isImage = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
  const isVideo = ['mp4','mkv','mov','avi','webm'].includes(ext);
  const isAudio = ['mp3','flac','wav','aac','ogg'].includes(ext);

  return (
    <div className="preview-panel">
      <div className="preview-panel__header">
        <span>{entry.name}</span>
        <button className="toolbar__btn" onClick={onClose} title="Close preview">
          <X size={16} />
        </button>
      </div>
      <div className="preview-panel__content">
        {/* Image preview */}
        {isImage && (
          <img
            className="preview-panel__image"
            src={`asset://${entry.path}`}
            alt={entry.name}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}

        {/* Video preview */}
        {isVideo && (
          <video
            controls
            style={{ width: '100%', borderRadius: 8, maxHeight: 200 }}
            src={`asset://${entry.path}`}
          />
        )}

        {/* Audio preview */}
        {isAudio && (
          <audio controls style={{ width: '100%' }} src={`asset://${entry.path}`} />
        )}

        {/* Text preview */}
        {textContent !== null && (
          <pre style={{
            fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--bg-overlay)', padding: 10,
            borderRadius: 6, maxHeight: 260, overflow: 'auto',
            fontFamily: 'monospace',
          }}>
            {textContent}
          </pre>
        )}

        {loading && <div className="skeleton skeleton--row" style={{ height: 120 }} />}

        {/* Metadata */}
        <div className="preview-panel__meta">
          <div style={{ marginBottom: 8, opacity: 0.5, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Details</div>
          <div className="preview-panel__meta-row">
            <span className="preview-panel__meta-label">Type</span>
            <span className="preview-panel__meta-value">{entry.isDir ? 'Folder' : (entry.extension?.toUpperCase() || 'File')}</span>
          </div>
          {!entry.isDir && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Size</span>
              <span className="preview-panel__meta-value">{formatFileSize(entry.size)}</span>
            </div>
          )}
          <div className="preview-panel__meta-row">
            <span className="preview-panel__meta-label">Modified</span>
            <span className="preview-panel__meta-value">{formatDate(entry.modified)}</span>
          </div>
          <div className="preview-panel__meta-row">
            <span className="preview-panel__meta-label">Created</span>
            <span className="preview-panel__meta-value">{formatDate(entry.created)}</span>
          </div>
          <div className="preview-panel__meta-row">
            <span className="preview-panel__meta-label">Path</span>
            <span className="preview-panel__meta-value" style={{ direction: 'rtl', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.path}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
