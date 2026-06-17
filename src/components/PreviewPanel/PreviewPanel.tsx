import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getFileIcon, formatFileSize, formatDate, opsApi, get_extended_metadata, get_image_thumbnail } from '../../api/tauri';
import type { FileEntry } from '../../types';

interface PreviewPanelProps {
  entry: FileEntry | null;
  onClose: () => void;
}

interface ExtendedMetadata {
  permissions: string | null;
  owner: string | null;
  group: string | null;
  accessed: string | null;
  modified: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  lineCount: number | null;
  wordCount: number | null;
  charCount: number | null;
  filesCount: number | null;
  foldersCount: number | null;
  mimeType: string | null;
  contentHash: string | null;
}

export function PreviewPanel({ entry, onClose }: PreviewPanelProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<ExtendedMetadata | null>(null);
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [loadFullImage, setLoadFullImage] = useState(false);

  useEffect(() => {
    setTextContent(null);
    setMeta(null);
    setThumbnailSrc(null);
    setLoadFullImage(false);
    if (!entry) return;

    // Fetch extended metadata
    get_extended_metadata(entry.path)
      .then(m => setMeta(m))
      .catch((e) => {
        console.error("Failed to get extended metadata:", e);
        setMeta(null);
      });

    const ext = (entry.extension || '').toLowerCase();
    const isImage = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);

    if (isImage) {
      get_image_thumbnail(entry.path)
        .then(src => setThumbnailSrc(src))
        .catch(() => setThumbnailSrc(null));
    }

    if (entry.isDir) return;

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
        {/* Image preview with thumbnail/high-res split load */}
        {isImage && (
          <div className="preview-panel__image-container" style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, background: 'rgba(0,0,0,0.1)' }}>
            <img
              className="preview-panel__image"
              src={loadFullImage ? `asset://${entry.path}` : (thumbnailSrc || '')}
              alt={entry.name}
              style={{
                filter: (!loadFullImage && thumbnailSrc) ? 'blur(1px)' : 'none',
                transition: 'filter 0.3s ease',
                display: (loadFullImage || thumbnailSrc) ? 'block' : 'none'
              }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {!loadFullImage && thumbnailSrc && (
              <button
                className="toolbar__btn"
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  background: 'rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(8px)',
                  color: 'white',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  fontSize: 10,
                  width: 'auto',
                  height: 'auto',
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  zIndex: 2,
                }}
                onClick={() => setLoadFullImage(true)}
              >
                Load High-Res
              </button>
            )}
          </div>
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
          {meta?.mimeType && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">MIME Type</span>
              <span className="preview-panel__meta-value" style={{ fontSize: 11 }}>{meta.mimeType}</span>
            </div>
          )}
          {meta?.contentHash && (
            <div className="preview-panel__meta-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span className="preview-panel__meta-label">CAS Address (FNV-1a)</span>
              <span className="preview-panel__meta-value" style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', textAlign: 'left', marginTop: 2 }}>
                {meta.contentHash}
              </span>
            </div>
          )}
          {meta?.filesCount !== null && meta?.filesCount !== undefined && meta?.foldersCount !== null && meta?.foldersCount !== undefined && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Contents</span>
              <span className="preview-panel__meta-value">{`${meta.filesCount} file${meta.filesCount !== 1 ? 's' : ''}, ${meta.foldersCount} folder${meta.foldersCount !== 1 ? 's' : ''}`}</span>
            </div>
          )}
          {meta?.imageWidth && meta?.imageHeight && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Dimensions</span>
              <span className="preview-panel__meta-value">{`${meta.imageWidth} × ${meta.imageHeight} px`}</span>
            </div>
          )}
          {meta?.lineCount !== null && meta?.lineCount !== undefined && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Lines</span>
              <span className="preview-panel__meta-value">{meta.lineCount.toLocaleString()}</span>
            </div>
          )}
          {meta?.wordCount !== null && meta?.wordCount !== undefined && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Words</span>
              <span className="preview-panel__meta-value">{meta.wordCount.toLocaleString()}</span>
            </div>
          )}
          {meta?.charCount !== null && meta?.charCount !== undefined && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Characters</span>
              <span className="preview-panel__meta-value">{meta.charCount.toLocaleString()}</span>
            </div>
          )}
          {meta?.permissions && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Permissions</span>
              <span className="preview-panel__meta-value" style={{ fontFamily: 'monospace' }}>{meta.permissions}</span>
            </div>
          )}
          {meta?.owner && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Owner</span>
              <span className="preview-panel__meta-value">{meta.owner}</span>
            </div>
          )}
          {meta?.group && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Group</span>
              <span className="preview-panel__meta-value">{meta.group}</span>
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
          {meta?.accessed && (
            <div className="preview-panel__meta-row">
              <span className="preview-panel__meta-label">Accessed</span>
              <span className="preview-panel__meta-value">{formatDate(meta.accessed)}</span>
            </div>
          )}
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
