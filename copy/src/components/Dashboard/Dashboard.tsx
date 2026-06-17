import React, { useEffect, useState } from 'react';
import { Image, Video, FileText, HardDrive, Smartphone, Download } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { fsApi, platformApi } from '../../api/tauri';
import { useDrives } from '../../hooks/useDrives';

interface CategoryProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}

function Category({ icon, label, color, onClick }: CategoryProps) {
  return (
    <button className="dashboard__card" onClick={onClick}>
      <div className="dashboard__card-icon" style={{ backgroundColor: color }}>
        {icon}
      </div>
      <span className="dashboard__card-label">{label}</span>
    </button>
  );
}

export function Dashboard() {
  const { navigate, state } = useApp();
  const { drives } = useDrives();
  const [homeDir, setHomeDir] = useState('');
  const [specialDirs, setSpecialDirs] = useState<Awaited<ReturnType<typeof fsApi.getSpecialDirs>> | null>(null);
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const [home, dirs] = await Promise.all([
          fsApi.getHomeDir(),
          fsApi.getSpecialDirs(),
        ]);
        if (!active) return;
        setHomeDir(home);
        setSpecialDirs(dirs);
        if (state.platform.os === 'android') {
          const allowed = await platformApi.checkAndroidPermission();
          if (!active) return;
          setHasPermission(allowed);
        } else {
          setHasPermission(true);
        }
      } catch {
        if (active) {
          setHasPermission(state.platform.os !== 'android');
        }
      }
    };

    const handleResume = () => {
      void refresh();
    };

    void refresh();
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    // Kotlin fires this event after any permission dialog is dismissed
    window.addEventListener('flashmesh:permission-changed', handleResume);

    return () => {
      active = false;
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('flashmesh:permission-changed', handleResume);
    };
  }, [state.platform.os]);

  const requestPermission = async () => {
    // First: call the Rust command, which emits a Tauri event to the frontend.
    // App.tsx's listener converts that into a native CustomEvent that Kotlin intercepts.
    await platformApi.requestAndroidPermission().catch(e => console.error(e));

    // Also dispatch directly in case the round-trip is not yet wired
    window.dispatchEvent(new CustomEvent('flashmesh:native-request-permission'));

    // Poll for up to 30 s after user interaction in case they grant from settings
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const ok = await platformApi.checkAndroidPermission().catch(() => false);
      if (ok || attempts >= 30) {
        clearInterval(poll);
        if (ok) setHasPermission(true);
      }
    }, 1000);
  };

  const androidRoot = specialDirs?.home || homeDir || '/storage/emulated/0';

  const categories = [
    { label: 'Images', icon: <Image size={24} />, color: '#3b82f6', path: specialDirs?.pictures || `${androidRoot}/Pictures` },
    { label: 'Videos', icon: <Video size={24} />, color: '#ef4444', path: specialDirs?.videos || `${androidRoot}/DCIM` },
    { label: 'Documents', icon: <FileText size={24} />, color: '#10b981', path: specialDirs?.documents || `${androidRoot}/Documents` },
    { label: 'Downloads', icon: <Download size={24} />, color: '#8b5cf6', path: specialDirs?.downloads || `${androidRoot}/Download` },
  ];

  return (
    <div className="dashboard">
      {!hasPermission && (
        <div className="dashboard__section" style={{ background: 'rgba(239, 68, 68, 0.1)', padding: 16, borderRadius: 16, border: '1px solid rgba(239, 68, 68, 0.2)', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ background: '#ef4444', padding: 8, borderRadius: 8, color: '#fff' }}><Smartphone size={20} /></div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Storage Access Required</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Android requires "All Files Access" to browse storage.</div>
            </div>
          </div>
          <button className="btn btn--primary" style={{ width: '100%', background: '#ef4444' }} onClick={requestPermission}>
            Grant Permission
          </button>
        </div>
      )}

      <div className="dashboard__section">
        <h2 className="dashboard__title">Storage</h2>
        <div className="dashboard__grid">
          {drives.map(drive => (
            <Category
              key={drive.mountPoint || drive.devicePath}
              icon={(drive.mountPoint || drive.devicePath).includes('emulated') ? <Smartphone size={24} /> : <HardDrive size={24} />}
              label={(drive.mountPoint || drive.devicePath).includes('emulated') ? 'Main Storage' : (drive.name || 'SD Card')}
              color={(drive.mountPoint || drive.devicePath).includes('emulated') ? 'var(--accent)' : '#64748b'}
              onClick={() => navigate(drive.mountPoint || drive.devicePath)}
            />
          ))}
        </div>
      </div>

      <div className="dashboard__section">
        <h2 className="dashboard__title">Categories</h2>
        <div className="dashboard__grid">
          {categories.map(cat => (
            <Category 
              key={cat.label} 
              {...cat} 
              onClick={() => navigate(cat.path)} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
