import React, { useEffect, useRef, useState } from 'react';
import { X, Settings as SettingsIcon, Command, Info, Cloud, MessageSquare, Send, ExternalLink, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { AppSettings, ViewMode } from '../../types';
import logoSrc from '/logo.png';
import { googleAdapter, dropboxAdapter } from '../../mesh/MeshEngine';
import { formatDiskSize } from '../../hooks/useDrives';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ── Cloud Accounts Tab ────────────────────────────────────────────────────────
// Google deprecated OOB redirect (urn:ietf:wg:oauth:2.0:oob) in Oct 2022.
// Dropbox never supported it. Tauri's webview also blocks window.open() popups.
//
// Fix: RFC 8252 loopback redirect. We start a temporary HTTP server in Rust,
// open the OAuth URL with redirect_uri=http://127.0.0.1:PORT, and capture
// the token via a Tauri event.

interface QuotaState {
  google: { usedSpace: number; totalSpace: number } | null;
  dropbox: { usedSpace: number; totalSpace: number } | null;
}

const getGoogleClientId = () => localStorage.getItem('google_client_id') || '376295481193-2gr1nfv4ef1u7dpqv865idj9p6m7m5ot.apps.googleusercontent.com';
const getDropboxAppKey = () => localStorage.getItem('dropbox_app_key') || 'cw5hv2tiupwm67c';

function buildGoogleUrl(port: number) {
  const clientId = getGoogleClientId();
  const redirect = `http://127.0.0.1:${port}`;
  return (
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}`
  );
}

function buildDropboxUrl(port: number) {
  const clientId = getDropboxAppKey();
  const redirect = `http://localhost:${port}/callback`;
  return (
    `https://www.dropbox.com/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirect)}`
  );
}

type AuthState = 'idle' | 'opening' | 'waiting' | 'connected' | 'error';

interface ProviderCardProps {
  provider: 'google' | 'dropbox';
  label: string;
  emoji: string;
  accentColor: string;
  isConnected: boolean;
  quota: { usedSpace: number; totalSpace: number } | null;
  onConnect: (token: string) => void;
  onDisconnect: () => void;
}

function ProviderCard({ provider, label, emoji, accentColor, isConnected, quota, onConnect, onDisconnect }: ProviderCardProps) {
  const [authState, setAuthState] = useState<AuthState>(isConnected ? 'connected' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Keep authState in sync when parent resets isConnected
  useEffect(() => {
    setAuthState(isConnected ? 'connected' : 'idle');
  }, [isConnected]);

  const handleSignIn = async () => {
    setError(null);
    setAuthState('opening');

    const isTauri = !!(window as any).__TAURI_INTERNALS__;

    if (!isTauri) {
      // Browser fallback flow
      try {
        const redirect = window.location.origin.includes('localhost')
          ? 'http://localhost:3000/callback'
          : (window.location.origin.includes('netlify.app')
              ? `${window.location.origin}/cloud.html`
              : window.location.origin);
              
        const url = provider === 'google'
          ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${getGoogleClientId()}&redirect_uri=${encodeURIComponent(redirect)}&response_type=token&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}`
          : `https://www.dropbox.com/oauth2/authorize?client_id=${getDropboxAppKey()}&redirect_uri=${encodeURIComponent(redirect)}&response_type=token`;

        const popup = window.open(url, 'Cloud Auth', 'width=500,height=600');
        const pollTimer = setInterval(() => {
          try {
            if (!popup || popup.closed) {
              clearInterval(pollTimer);
              setAuthState('idle');
              return;
            }
            if (popup.location.href.includes('access_token=')) {
              const hash = popup.location.hash.substring(1);
              const params = new URLSearchParams(hash);
              const token = params.get('access_token');
              if (token) {
                onConnect(token);
                setAuthState('connected');
                popup.close();
                clearInterval(pollTimer);
              }
            }
          } catch (e) {
            // cross-origin error is normal during redirect
          }
        }, 500);
        setAuthState('waiting');
      } catch (e: any) {
        setAuthState('error');
        setError(`Auth failed: ${e?.message ?? String(e)}`);
      }
      return;
    }

    try {
      // 1. Start the Rust loopback server → get the free port
      // Google uses 0 (random port), Dropbox uses 3000 (fixed to match registered callback)
      const oauthPort = provider === 'dropbox' ? 3000 : 0;
      const port = await invoke<number>('start_oauth_server', { port: oauthPort });

      // 2. Listen for the token event BEFORE opening the browser
      const unlisten = await listen<string>('flashmesh:oauth-token', (event) => {
        const token = event.payload;
        if (unlisten) unlisten();
        unlistenRef.current = null;
        onConnect(token);
        setAuthState('connected');
      });
      unlistenRef.current = unlisten;

      // 3. Build provider-specific URL with the loopback redirect
      const url = provider === 'google' ? buildGoogleUrl(port) : buildDropboxUrl(port);

      // 4. Open the URL in the system browser
      await openUrl(url);
      setAuthState('waiting');
    } catch (e: any) {
      setAuthState('error');
      setError(`Auth failed: ${e?.message ?? String(e)}`);
    }
  };

  const handleCancel = () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    setAuthState('idle');
    setError(null);
  };

  const handleDisconnect = () => {
    onDisconnect();
    setAuthState('idle');
  };

  const usedPct = quota && quota.totalSpace > 0 ? (quota.usedSpace / quota.totalSpace) * 100 : 0;

  return (
    <div style={{
      border: `1px solid ${isConnected ? accentColor + '50' : 'var(--border)'}`,
      borderRadius: 14, padding: 20, marginBottom: 16,
      background: isConnected ? accentColor + '0a' : 'var(--bg-surface)',
      transition: 'all 300ms',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: isConnected && quota ? 14 : (authState !== 'idle' ? 14 : 0) }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: accentColor + '18', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0,
        }}>{emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {isConnected
              ? quota
                ? `${formatDiskSize(quota.usedSpace)} used of ${formatDiskSize(quota.totalSpace)}`
                : 'Connected ✓'
              : authState === 'waiting'
                ? 'Waiting for browser sign-in…'
                : 'Not connected'}
          </div>
        </div>
        {isConnected && <CheckCircle size={18} color="#4ade80" />}
      </div>

      {/* Usage bar */}
      {isConnected && quota && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${usedPct}%`, background: `linear-gradient(90deg, ${accentColor}, ${accentColor}bb)`, borderRadius: 2, transition: 'width 700ms' }} />
          </div>
        </div>
      )}

      {/* Action area */}
      {isConnected ? (
        <button className="btn btn--secondary" style={{ width: '100%', fontSize: 13, color: 'var(--error)' }} onClick={handleDisconnect}>
          Disconnect
        </button>
      ) : authState === 'waiting' || authState === 'opening' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', padding: '10px 12px', background: 'var(--bg-overlay)', borderRadius: 8 }}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span>
              {authState === 'opening'
                ? 'Opening browser…'
                : 'Sign in to continue — the app will connect automatically when you\'re done.'}
            </span>
          </div>
          <button className="btn btn--secondary" style={{ fontSize: 13 }} onClick={handleCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {authState === 'error' && error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#fbbf24', background: 'rgba(251,191,36,.08)', padding: '8px 12px', borderRadius: 8, lineHeight: 1.5 }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}
          <button
            className="btn btn--primary"
            style={{ width: '100%', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={handleSignIn}
          >
            <ExternalLink size={14} />
            Sign In with {provider === 'google' ? 'Google' : 'Dropbox'}
          </button>
        </div>
      )}
    </div>
  );
}

function CloudAccountsTab({ quotas, setQuotas }: { quotas: QuotaState; setQuotas: (q: QuotaState) => void }) {
  const [googleConnected, setGoogleConnected] = useState(() => googleAdapter.isAuthenticated);
  const [dropboxConnected, setDropboxConnected] = useState(() => dropboxAdapter.isAuthenticated);

  const [showCreds, setShowCreds] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(() => localStorage.getItem('google_client_id') || '');
  const [googleApiKey, setGoogleApiKey] = useState(() => localStorage.getItem('google_api_key') || '');
  const [dropboxAppKey, setDropboxAppKey] = useState(() => localStorage.getItem('dropbox_app_key') || '');
  const [dropboxAppSecret, setDropboxAppSecret] = useState(() => localStorage.getItem('dropbox_app_secret') || '');

  const handleCredChange = (key: string, value: string, setter: (v: string) => void) => {
    setter(value);
    if (value.trim()) {
      localStorage.setItem(key, value.trim());
    } else {
      localStorage.removeItem(key);
    }
  };

  const handleGoogleConnect = (token: string) => {
    (googleAdapter as any).accessToken = token;
    localStorage.setItem('google_token', token);
    setGoogleConnected(true);
    googleAdapter.getQuota()
      .then(q => { if (q) setQuotas({ ...quotas, google: q }); })
      .catch(() => setQuotas({ ...quotas, google: { usedSpace: 0, totalSpace: 15 * 1024 * 1024 * 1024 } }));
  };

  const handleGoogleDisconnect = () => {
    (googleAdapter as any).accessToken = null;
    localStorage.removeItem('google_token');
    setGoogleConnected(false);
    setQuotas({ ...quotas, google: null });
  };

  const handleDropboxConnect = (token: string) => {
    (dropboxAdapter as any).accessToken = token;
    localStorage.setItem('dropbox_token', token);
    setDropboxConnected(true);
    dropboxAdapter.getQuota()
      .then(q => { if (q) setQuotas({ ...quotas, dropbox: q }); })
      .catch(() => setQuotas({ ...quotas, dropbox: { usedSpace: 0, totalSpace: 2 * 1024 * 1024 * 1024 } }));
  };

  const handleDropboxDisconnect = () => {
    (dropboxAdapter as any).accessToken = null;
    localStorage.removeItem('dropbox_token');
    setDropboxConnected(false);
    setQuotas({ ...quotas, dropbox: null });
  };

  return (
    <>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>
        Connected Storage
      </div>

      <ProviderCard
        provider="google"
        label="Google Drive"
        emoji="🔵"
        accentColor="#4285F4"
        isConnected={googleConnected}
        quota={quotas.google}
        onConnect={handleGoogleConnect}
        onDisconnect={handleGoogleDisconnect}
      />

      <ProviderCard
        provider="dropbox"
        label="Dropbox"
        emoji="🔷"
        accentColor="#0061FF"
        isConnected={dropboxConnected}
        quota={quotas.dropbox}
        onConnect={handleDropboxConnect}
        onDisconnect={handleDropboxDisconnect}
      />

      {/* Developer API credentials setup panel */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowCreds(!showCreds)}
          className="btn btn--secondary"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 10,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            🔑 <span>Developer API Credentials</span>
          </span>
          <span style={{ fontSize: 10 }}>{showCreds ? '▲' : '▼'}</span>
        </button>

        {showCreds && (
          <div style={{
            marginTop: 12,
            padding: 16,
            borderRadius: 12,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 4 }}>
              If you get <strong>Authorization Errors (Error 401)</strong>, paste your custom App Credentials here. If left empty, default credentials will be used.
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                Google Drive Client ID
              </label>
              <input
                type="text"
                placeholder="Enter custom Google OAuth 2.0 Client ID"
                value={googleClientId}
                onChange={e => handleCredChange('google_client_id', e.target.value, setGoogleClientId)}
                className="settings-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                Google API Key
              </label>
              <input
                type="text"
                placeholder="Enter custom Google API Key (optional)"
                value={googleApiKey}
                onChange={e => handleCredChange('google_api_key', e.target.value, setGoogleApiKey)}
                className="settings-input"
              />
            </div>

            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                Dropbox App Key
              </label>
              <input
                type="text"
                placeholder="Enter custom Dropbox App Key"
                value={dropboxAppKey}
                onChange={e => handleCredChange('dropbox_app_key', e.target.value, setDropboxAppKey)}
                className="settings-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                Dropbox App Secret
              </label>
              <input
                type="password"
                placeholder="Enter custom Dropbox App Secret"
                value={dropboxAppSecret}
                onChange={e => handleCredChange('dropbox_app_secret', e.target.value, setDropboxAppSecret)}
                className="settings-input"
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderRadius: 10, background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#3b82f6', fontWeight: 600, fontSize: 13 }}>
          <Cloud size={14} /> FlashMesh Unified Mesh
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Connect Google Drive and/or Dropbox. FlashMesh bonds both into a single encrypted mesh — files are AES-256 chunked and distributed across your combined cloud space.
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0, opacity: 0.65 }}>
          ℹ️ Auth opens in your system browser. FlashMesh auto-connects once you sign in — no copy-pasting required.
        </p>
      </div>
    </>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingsRow({ label, description, children }: SettingsRowProps) {
  const { state } = useApp();
  const isMobile = state.platform.isMobile;
  
  return (
    <div style={{
      display: 'flex', 
      flexDirection: isMobile ? 'column' : 'row',
      justifyContent: 'space-between', 
      alignItems: isMobile ? 'flex-start' : 'center',
      padding: '16px 0', 
      borderBottom: '1px solid var(--border)',
      gap: isMobile ? 12 : 0
    }}>
      <div style={{ flex: 1, paddingRight: isMobile ? 0 : 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{description}</div>}
      </div>
      <div style={{ width: isMobile ? '100%' : 'auto', display: 'flex', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 99, border: 'none',
        background: checked ? 'var(--accent)' : 'var(--bg-overlay)',
        position: 'relative', cursor: 'pointer',
        transition: 'background 200ms',
        boxShadow: checked ? 'var(--shadow-glow)' : 'none',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%', background: 'white',
        transition: 'left 200ms var(--ease-spring)',
        display: 'block',
      }} />
    </button>
  );
}

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { state, dispatch } = useApp();
  const { settings } = state;
  const [activeTab, setActiveTab] = useState<'general' | 'shortcuts' | 'cloud' | 'about' | 'feedback'>('general');
  const [quotas, setQuotas] = useState<{ google: { usedSpace: number, totalSpace: number } | null, dropbox: { usedSpace: number, totalSpace: number } | null }>({
    google: null,
    dropbox: null,
  });

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    dispatch({ type: 'UPDATE_SETTINGS', settings: { [key]: value } });
  };

  const tabs = [
    { id: 'general', label: 'General', icon: <SettingsIcon size={16} /> },
    { id: 'cloud', label: 'Cloud Accounts', icon: <Cloud size={16} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Command size={16} /> },
    { id: 'feedback', label: 'Feedback', icon: <MessageSquare size={16} /> },
    { id: 'about', label: 'About', icon: <Info size={16} /> },
  ] as const;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
        <div 
          className="dialog" 
          style={{ 
            width: state.platform.isMobile ? '100vw' : '90vw', 
            maxWidth: state.platform.isMobile ? 'none' : 800, 
            height: state.platform.isMobile ? '100vh' : '80vh', 
            maxHeight: state.platform.isMobile ? 'none' : 600, 
            borderRadius: state.platform.isMobile ? 0 : undefined,
            padding: 0, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden' 
          }} 
          onClick={e => e.stopPropagation()}
        >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <div className="dialog__title" style={{ marginBottom: 0 }}>⚙️ Settings</div>
          <button className="toolbar__btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{ 
            width: state.platform.isMobile ? 60 : 220, 
            borderRight: '1px solid var(--border)', 
            background: 'var(--bg-overlay)', 
            padding: '16px 8px' 
          }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: state.platform.isMobile ? 'center' : 'flex-start',
                  gap: 12, width: '100%', padding: state.platform.isMobile ? '12px 0' : '10px 16px',
                  borderRadius: 8, border: 'none', background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
                  transition: 'background 150ms, color 150ms',
                  marginBottom: 4
                }}
                title={tab.label}
              >
                {tab.icon}
                {!state.platform.isMobile && tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: state.platform.isMobile ? '16px' : '24px 32px' }}>
            {activeTab === 'general' && (
              <>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>Appearance</div>
                
                <SettingsRow label="Default View" description="How files are displayed by default">
                  <select
                    value={settings.defaultView}
                    onChange={e => update('defaultView', e.target.value as ViewMode)}
                    className="settings-select"
                  >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                    <option value="compact">Compact</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Theme" description="Color theme for the app">
                  <select
                    value={settings.theme}
                    onChange={e => update('theme', e.target.value as 'dark' | 'light' | 'system' | 'elevanix')}
                    className="settings-select"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                    <option value="elevanix">⚡ Elevanix (Classic)</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Radial Context Menu" description="Show the Omnitrix circular context menu (matches the classic Elevanix UI)">
                  <Toggle checked={settings.omnitrixMenu} onChange={v => update('omnitrixMenu', v)} />
                </SettingsRow>

                <SettingsRow label="Icon Package" description="Style of file and folder icons">
                  <select
                    value={settings.iconPackage}
                    onChange={e => update('iconPackage', e.target.value as any)}
                    className="settings-select"
                  >
                    <option value="rounded">Modern Rounded</option>
                    <option value="vibrant">Vibrant Colors</option>
                    <option value="minimal">Minimalist</option>
                    <option value="sharp">Sharp (Standard)</option>
                  </select>
                </SettingsRow>

                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', margin: '32px 0 8px', fontWeight: 600 }}>Files & Navigation</div>

                <SettingsRow label="Show Hidden Files" description="Display files starting with a dot">
                  <Toggle checked={settings.showHiddenFiles} onChange={v => update('showHiddenFiles', v)} />
                </SettingsRow>

                <SettingsRow label="Show File Extensions" description="Display file extensions in names">
                  <Toggle checked={settings.showFileExtensions} onChange={v => update('showFileExtensions', v)} />
                </SettingsRow>

                <SettingsRow label="Confirm Before Delete" description="Show a dialog before sending to Trash">
                  <Toggle checked={settings.confirmBeforeDelete} onChange={v => update('confirmBeforeDelete', v)} />
                </SettingsRow>

                <SettingsRow label="Hover to Open" description="Open files and folders after hovering without moving">
                  <Toggle checked={settings.hoverOpenItems} onChange={v => update('hoverOpenItems', v)} />
                </SettingsRow>

                <SettingsRow label="Hover Delay" description="How long the pointer must stay still">
                  <select
                    value={settings.hoverOpenDelay}
                    onChange={e => update('hoverOpenDelay', Number(e.target.value))}
                    disabled={!settings.hoverOpenItems}
                    className="settings-select"
                    style={{ opacity: settings.hoverOpenItems ? 1 : 0.5 }}
                  >
                    <option value={1000}>1 second</option>
                    <option value={1500}>1.5 seconds</option>
                    <option value={2000}>2 seconds</option>
                    <option value={3000}>3 seconds</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Recent History Limit" description="Maximum number of files & folders tracked in Recent tab">
                  <select
                    value={settings.recentHistoryLimit}
                    onChange={e => update('recentHistoryLimit', Number(e.target.value))}
                    className="settings-select"
                  >
                    <option value={10}>10 items</option>
                    <option value={20}>20 items</option>
                    <option value={50}>50 items</option>
                    <option value={100}>100 items</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Drag & Drop Action" description="Default behavior when dropping items">
                  <select
                    value={settings.dragDropAction}
                    onChange={e => update('dragDropAction', e.target.value as any)}
                    className="settings-select"
                  >
                    <option value="ask">Always Ask</option>
                    <option value="move">Move Items</option>
                    <option value="copy">Copy Items</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Startup Folder" description="Location opened for new sessions and new tabs">
                  <input
                    value={settings.startupFolder}
                    onChange={e => update('startupFolder', e.target.value)}
                    placeholder="/"
                    style={{
                      background: 'var(--bg-overlay)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      width: 240,
                    }}
                  />
                </SettingsRow>

                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', margin: '32px 0 8px', fontWeight: 600 }}>Mesh Storage Protocol</div>

                <SettingsRow label="Turbo Mode (Parallel Workers)" description="Intelligently download/upload files using 16 concurrent workers (highly recommended for high speed)">
                  <Toggle checked={settings.turboMode} onChange={v => {
                    update('turboMode', v);
                    if (v) update('concurrencyLimit', 16);
                  }} />
                </SettingsRow>

                <SettingsRow label="Concurrency Workers Limit" description="Custom number of concurrent worker threads (1-16)">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 240 }}>
                    <input
                      type="range"
                      min="1"
                      max="16"
                      disabled={settings.turboMode}
                      value={settings.concurrencyLimit}
                      onChange={e => update('concurrencyLimit', Number(e.target.value))}
                      style={{
                        flex: 1,
                        accentColor: 'var(--accent)',
                        opacity: settings.turboMode ? 0.5 : 1,
                        cursor: settings.turboMode ? 'not-allowed' : 'pointer'
                      }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 64, textAlign: 'right' }}>
                      {settings.concurrencyLimit} threads
                    </span>
                  </div>
                </SettingsRow>

                <SettingsRow label="Chunk Slicing Strategy" description="How files are split into pieces across providers">
                  <select
                    value={settings.chunkSizeRange}
                    onChange={e => update('chunkSizeRange', e.target.value as any)}
                    className="settings-select"
                  >
                    <option value="1-3mb">⚡ Dynamic 1-3MB (Pattern Shield)</option>
                    <option value="fixed-2mb">Fixed 2MB (Simple Chunks)</option>
                  </select>
                </SettingsRow>

                <SettingsRow label="Encryption Strength" description="Select the security policy for uploaded chunks">
                  <select
                    value={settings.encryptionStrategy}
                    onChange={e => update('encryptionStrategy', e.target.value as any)}
                    className="settings-select"
                  >
                    <option value="adaptive">🛡️ Adaptive (Headers Encrypted, 25% raw for speed)</option>
                    <option value="aes-gcm">Maximum Security (AES-256-GCM only)</option>
                    <option value="aes-cbc-hmac">Integrity Checked (AES-256-CBC-HMAC)</option>
                    <option value="none">Plaintext (No Encryption)</option>
                  </select>
                </SettingsRow>
              </>
            )}

            {activeTab === 'cloud' && (
              <CloudAccountsTab
                quotas={quotas}
                setQuotas={setQuotas}
              />
            )}

            {activeTab === 'shortcuts' && (
              <>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>Keyboard Shortcuts</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) auto', gap: '12px 24px' }}>
                  {[
                    ['Ctrl+T', 'New tab'],
                    ['Ctrl+W', 'Close tab'],
                    ['Ctrl+N', 'New file'],
                    ['Ctrl+Shift+N', 'New folder'],
                    ['Enter', 'Open selected item'],
                    ['Ctrl+C', 'Copy'],
                    ['Ctrl+X', 'Cut'],
                    ['Ctrl+V', 'Paste'],
                    ['Ctrl+Z', 'Undo'],
                    ['Ctrl+Shift+Z', 'Redo'],
                    ['Ctrl+A', 'Select All'],
                    ['F2', 'Rename'],
                    ['Delete', 'Move to Trash'],
                    ['Shift+Delete', 'Delete Permanently'],
                    ['F5', 'Refresh'],
                    ['Alt+Left', 'Back'],
                    ['Alt+Right', 'Forward'],
                    ['Alt+Up', 'Go Up'],
                    ['Ctrl+L', 'Focus address bar'],
                    ['Ctrl+F', 'Focus search'],
                    ['Ctrl+Space', 'Spotlight search'],
                    ['Space', 'Toggle preview'],
                  ].map(([key, label], i) => (
                    <React.Fragment key={i}>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                        {label}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <kbd style={{
                          padding: '4px 8px', background: 'var(--bg-overlay)',
                          border: '1px solid var(--border)', borderRadius: 4,
                          fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)',
                          boxShadow: '0 2px 0 var(--border)'
                        }}>{key}</kbd>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'feedback' && (
              <div style={{ maxWidth: 600 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>Support & Feedback</div>
                
                <SettingsRow label="Automatic Error Reporting" description="Help us improve FlashMesh by automatically sending anonymized error reports when something goes wrong.">
                  <Toggle checked={settings.autoErrorReporting} onChange={v => update('autoErrorReporting', v)} />
                </SettingsRow>

                <SettingsRow label="Your Email" description="Used to identify your reports and respond to your feedback.">
                   <input
                    value={settings.userEmail}
                    onChange={e => update('userEmail', e.target.value)}
                    placeholder="t.dhanushit@gmail.com"
                    style={{
                      background: 'var(--bg-overlay)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      width: 240,
                    }}
                  />
                </SettingsRow>

                <div style={{ marginTop: 32 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Send Manual Feedback</div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Have a feature request or found a bug? Let us know! This will open your email client.</p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input 
                      id="feedback-subject"
                      placeholder="Subject (e.g. Feature Request: Darker Mode)"
                      style={{
                        background: 'var(--bg-overlay)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '10px 14px',
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    />
                    <textarea 
                      id="feedback-message"
                      placeholder="Tell us what's on your mind..."
                      rows={5}
                      style={{
                        background: 'var(--bg-overlay)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '12px 14px',
                        borderRadius: 8,
                        fontSize: 13,
                        resize: 'none',
                        fontFamily: 'inherit'
                      }}
                    />
                    <button 
                      className="btn btn--primary" 
                      style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}
                      onClick={() => {
                        const subject = (document.getElementById('feedback-subject') as HTMLInputElement).value;
                        const message = (document.getElementById('feedback-message') as HTMLTextAreaElement).value;
                        if (!message) return;
                        import('../../utils/FeedbackService').then(({ feedbackService }) => {
                          feedbackService.sendManualFeedback(settings.userEmail, subject || 'General Feedback', message, state.platform);
                        });
                      }}
                    >
                      <Send size={14} /> Send via Email
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 40, padding: 16, borderRadius: 12, background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                   <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Privacy Note</div>
                   <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                     Manual feedback is sent via your system's default email client. Automatic reports include platform info, version, and error stack traces to help debugging. We never collect the contents of your files.
                   </p>
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ 
                  margin: '0 auto 20px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img
                    src={logoSrc}
                    alt="FlashMesh"
                    style={{
                      width: 96,
                      height: 96,
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 0 18px rgba(99,102,241,0.55))',
                    }}
                  />
                </div>
                <h2 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--text-primary)' }}>FlashMesh</h2>
                <p style={{ margin: '0 0 32px', color: 'var(--text-secondary)', fontSize: 14 }}>A blazing-fast cross-platform file manager built with Tauri and React.</p>
                
                <div style={{ 
                  background: 'var(--bg-overlay)', border: '1px solid var(--border)', 
                  borderRadius: 12, padding: 20, textAlign: 'left',
                  display: 'inline-block', minWidth: 320
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Version</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>0.1.0</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Parent Company</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>Elevanix</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Tauri Backend</span>
                    <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>v2.0.0</span>
                  </div>
                  
                  <div style={{ height: '1px', background: 'var(--border)', margin: '16px 0' }} />
                  
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>Lead Developer</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>Dhanush</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12, opacity: 0.8 }}>t.dhanushit@gmail.com</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-panel)' }}>
          <button className="btn btn--primary" onClick={onClose} style={{ minWidth: 100 }}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}
