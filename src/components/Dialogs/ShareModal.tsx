import React, { useEffect, useState } from 'react';
import { FileEntry } from '../../types';
import { formatFileSize, start_share_server, stop_share_server, get_share_status } from '../../api/tauri';
import { Copy, Check, Loader2, Wifi, WifiOff } from 'lucide-react';

interface ShareModalProps {
  entry: FileEntry;
  onClose: () => void;
}

export function ShareModal({ entry, onClose }: ShareModalProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    async function initSharing() {
      try {
        setLoading(true);
        setError(null);
        // Check if there is an active share session first
        const status = await get_share_status();
        if (status) {
          if (active) {
            setShareUrl(status);
            setLoading(false);
          }
          return;
        }

        // Otherwise, start the share server for this file
        const url = await start_share_server(entry.path);
        if (active) {
          setShareUrl(url);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || String(err));
          setLoading(false);
        }
      }
    }

    initSharing();

    return () => {
      active = false;
    };
  }, [entry.path]);

  const handleStopSharing = async () => {
    try {
      setLoading(true);
      await stop_share_server();
      onClose();
    } catch (err: any) {
      setError(`Failed to stop sharing: ${err.message || String(err)}`);
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <style>{`
        @keyframes mesh-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-custom {
          animation: mesh-spin 1s linear infinite;
        }
      `}</style>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div className="dialog__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Wifi className="text-accent" style={{ color: 'var(--accent)' }} size={20} />
          <span>Local Wi-Fi Sharing</span>
        </div>

        <div className="dialog__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '12px',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>File:</span>
              <strong style={{ color: 'var(--text-primary)', wordBreak: 'break-all', textAlign: 'right' }}>{entry.name}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Size:</span>
              <span style={{ color: 'var(--text-secondary)' }}>{formatFileSize(entry.size)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Path:</span>
              <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all', fontSize: '10px', opacity: 0.8, textAlign: 'right' }}>{entry.path}</span>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 0', gap: '12px' }}>
              <Loader2 className="animate-spin-custom" style={{ color: 'var(--accent)' }} size={32} />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Starting local stream server...</span>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0', gap: '12px', color: '#f87171' }}>
              <WifiOff size={32} />
              <span style={{ fontSize: '13px', textAlign: 'center' }}>{error}</span>
            </div>
          ) : shareUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {/* QR Code Container */}
              <div style={{
                background: 'white',
                padding: '12px',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`}
                  alt="QR Code"
                  style={{ width: '180px', height: '180px', display: 'block' }}
                />
              </div>

              {/* URL Display */}
              <div style={{ width: '100%' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Stream Link (Wi-Fi / LAN Network)
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'var(--bg-overlay)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--accent)',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    className="btn btn--secondary"
                    onClick={handleCopyLink}
                    style={{ padding: '0 12px', flexShrink: 0 }}
                    title="Copy Link"
                  >
                    {copied ? <Check size={16} style={{ color: '#4ade80' }} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="dialog__actions" style={{ marginTop: '24px' }}>
          <button className="btn btn--secondary" onClick={onClose} disabled={loading}>
            Close
          </button>
          <button className="btn btn--danger" onClick={handleStopSharing} disabled={loading}>
            Stop Sharing
          </button>
        </div>
      </div>
    </div>
  );
}
