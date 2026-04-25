import React, { useState } from 'react';
import { X, Settings as SettingsIcon, Command, Info, Cloud, MessageSquare, Send } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import type { AppSettings, ViewMode } from '../../types';
import logoSrc from '/logo.png';
import { googleAdapter, dropboxAdapter } from '../../mesh/MeshEngine';
import { formatDiskSize } from '../../hooks/useDrives';

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
                    onChange={e => update('theme', e.target.value as 'dark' | 'light' | 'system')}
                    className="settings-select"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
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
              </>
            )}

            {activeTab === 'cloud' && (
              <>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>Connected Storage Integrations</div>
                
                <SettingsRow label="Google Drive" description={quotas.google ? `${formatDiskSize(quotas.google.usedSpace)} used of ${formatDiskSize(quotas.google.totalSpace)}` : "Not connected to Google Drive. Click Sign In to authorize FlashMesh."}>
                  {!googleAdapter.isAuthenticated ? (
                     <button className="btn btn--primary" onClick={() => googleAdapter.authenticate().then(() => setQuotas({ ...quotas, google: { usedSpace: 0, totalSpace: 15*1024*1024*1024 } }))}>Sign In</button>
                  ) : (
                     <button className="btn btn--secondary" style={{ color: 'var(--error)' }}>Disconnect</button>
                  )}
                </SettingsRow>

                <SettingsRow label="Dropbox" description={quotas.dropbox ? `${formatDiskSize(quotas.dropbox.usedSpace)} used of ${formatDiskSize(quotas.dropbox.totalSpace)}` : "Not connected to Dropbox. Click Sign In to authorize FlashMesh."}>
                  {!dropboxAdapter.isAuthenticated ? (
                     <button className="btn btn--primary" onClick={() => dropboxAdapter.authenticate().then(() => setQuotas({ ...quotas, dropbox: { usedSpace: 0, totalSpace: 2*1024*1024*1024 } }))}>Sign In</button>
                  ) : (
                     <button className="btn btn--secondary" style={{ color: 'var(--error)' }}>Disconnect</button>
                  )}
                </SettingsRow>

                <div style={{ marginTop: 24, padding: 16, borderRadius: 8, background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#3b82f6', fontWeight: 500 }}>
                      <Cloud size={16} /> FlashMesh Unified File System
                   </div>
                   <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                      When you connect multiple cloud providers, FlashMesh bonds them into a single massively parallel distributed mesh. Chunks are automatically encrypted with AES-256 and scattered seamlessly across your total combined space.
                   </p>
                </div>
              </>
            )}

            {activeTab === 'shortcuts' && (
              <>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 16, fontWeight: 600 }}>Keyboard Shortcuts</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) auto', gap: '12px 24px' }}>
                  {[
                    ['Ctrl+T', 'New tab'],
                    ['Ctrl+W', 'Close tab'],
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
