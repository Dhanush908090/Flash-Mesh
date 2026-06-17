import React, { useMemo, useState, useEffect } from 'react';
import {
  Home, Download, FileText, Image, Film, Music,
  Star, HardDrive, ChevronDown, ChevronRight,
  Laptop, Clock, Plus, X, Trash2, Smartphone, Database
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useDrives, formatDiskSize } from '../../hooks/useDrives';
import { fsApi } from '../../api/tauri';
import { RECENT_PATH, TRASH_PATH } from '../../utils/path';
import { showToast } from '../Toast/Toast';
import { meshEngine } from '../../mesh/MeshEngine';
import { Cloud } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
}

interface SectionProps {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
  renderSuffix?: (item: NavItem) => React.ReactNode;
}

function NavSection({ title, items, defaultOpen = true, renderSuffix }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { navigate, activeTab, state, dispatch } = useApp();

  const handleNavigate = (path: string) => {
    // Always switch back to files view so pool/cloud/pet views don't trap the user
    if (state.currentView !== 'files') {
      dispatch({ type: 'SET_VIEW', view: 'files' });
    }
    navigate(path);
    if (state.platform.isMobile) {
      dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
    }
  };

  return (
    <div className="nav-section">
      <button className="nav-section__header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </button>
      {open && (
        <ul className="nav-section__list">
          {items.map(item => (
            <li key={item.id}>
              <button
                className={`nav-item${activeTab.path === item.path ? ' nav-item--active' : ''}`}
                onClick={() => handleNavigate(item.path)}
                title={item.label}
              >
                <span className="nav-item__icon">{item.icon}</span>
                <span className="nav-item__label">{item.label}</span>
                {renderSuffix?.(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DrivesSection() {
  const [open, setOpen] = useState(true);
  const { navigate, activeTab, state, dispatch } = useApp();
  const { drives, loading } = useDrives();

  if (!state.platform.supportsDrives) return null;

  const getDriveLabel = (drive: typeof drives[number]) => {
    const mount = drive.mountPoint || '';
    if (mount === '/') return 'System';
    const mountName = mount.split(/[\\/]/).filter(Boolean).pop();
    if (mountName) return mountName;
    const deviceName = drive.devicePath.split(/[\\/]/).filter(Boolean).pop();
    return deviceName || drive.name || 'Drive';
  };

  return (
    <div className="nav-section">
      <button className="nav-section__header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Drives</span>
      </button>
      {open && (
        <ul className="nav-section__list">
          {loading && (
            <li style={{ padding: '4px 8px' }}>
              <div className="skeleton skeleton--row" style={{ height: 24 }} />
            </li>
          )}
          {!loading && drives.map(drive => {
            const usedPct = drive.totalSpace > 0
              ? Math.round((drive.usedSpace / drive.totalSpace) * 100)
              : 0;
            const targetPath = (drive.mountPoint || drive.devicePath || '').trim();
            const label = getDriveLabel(drive);
            const location = drive.mountPoint || 'not mounted';
            const isActive = drive.mountPoint
              ? activeTab.path === drive.mountPoint
              : activeTab.path === drive.devicePath;
            
            // Clean up Android label
            const displayLabel = state.platform.os === 'android' && targetPath === '/storage/emulated/0'
              ? 'Internal Storage'
              : label;

            return (
              <li key={drive.devicePath}>
                <button
                  className={`nav-item nav-item--drive${isActive ? ' nav-item--drive--active' : ''}`}
                  onClick={() => {
                    if (!targetPath) {
                      showToast({ message: 'Drive path is unavailable.' });
                      return;
                    }
                    if (state.currentView !== 'files') {
                      dispatch({ type: 'SET_VIEW', view: 'files' });
                    }
                    navigate(targetPath);
                    if (state.platform.isMobile) {
                      dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
                    }
                    if (!drive.isMounted || !drive.mountPoint) {
                      showToast({ message: 'Device is not mounted; cannot browse yet.' });
                    }
                  }}
                  title={
                    drive.isMounted && drive.mountPoint
                      ? `${label} - ${formatDiskSize(drive.availableSpace)} free of ${formatDiskSize(drive.totalSpace)} at ${drive.mountPoint}`
                      : `${label} - Not mounted`
                  }
                >
                  <span className="nav-item__icon"><HardDrive size={18} /></span>
                  <div className="nav-item__drive-info">
                    <span className="nav-item__label">{displayLabel}</span>
                    <span className="nav-item__drive-path">{location}</span>
                    <div className="drive-bar">
                      <div
                        className="drive-bar__fill"
                        style={{
                          width: `${usedPct}%`,
                          background: usedPct > 90
                            ? 'linear-gradient(90deg, #ef4444, #f87171)'
                            : usedPct > 75
                            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                            : undefined,
                        }}
                      />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CloudSection() {
  const [open, setOpen] = useState(true);
  const { navigate, activeTab, state, dispatch } = useApp();
  const [quota, setQuota] = useState<{ usedSpace: number, totalSpace: number } | null>(null);

  // Attempt to fetch combined quotas periodically
  useEffect(() => {
    const fetchQuotas = async () => {
      try {
        const q = await meshEngine.getUnifiedQuota();
        if (q.totalSpace > 0) setQuota(q);
      } catch (e) {
        console.error("Failed to fetch cloud quotas:", e);
      }
    };
    
    fetchQuotas();
    const interval = setInterval(fetchQuotas, 30000);
    return () => clearInterval(interval);
  }, []);

  const renderUnifiedCloudItem = () => {
    const isActive = activeTab.path.startsWith(`mesh://`);
    const usedPct = quota && quota.totalSpace > 0 ? Math.round((quota.usedSpace / quota.totalSpace) * 100) : 0;
    const targetPath = `mesh://root`;

    return (
      <li>
        <button
          className={`nav-item nav-item--drive${isActive ? ' nav-item--active' : ''}`}
          onClick={() => {
            if (state.currentView !== 'files') dispatch({ type: 'SET_VIEW', view: 'files' });
            navigate(targetPath);
          }}
          title={`FlashMesh Cloud - ${quota ? formatDiskSize(quota.totalSpace - quota.usedSpace) : '...'} free of ${quota ? formatDiskSize(quota.totalSpace) : '...'}`}
        >
          <span className="nav-item__icon"><Cloud size={16} color="#3b82f6" /></span>
          <div className="nav-item__drive-info">
            <span className="nav-item__label">FlashMesh Cloud</span>
            <span className="nav-item__drive-path">{`mesh://root`}</span>
            <div className="drive-bar" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className="drive-bar__fill"
                style={{
                  width: `${usedPct}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #6366f1)',
                }}
              />
            </div>
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className="nav-section">
      <button className="nav-section__header" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>FlashMesh Cloud</span>
      </button>
      {open && (
        <ul className="nav-section__list">
          {renderUnifiedCloudItem()}
        </ul>
      )}
    </div>
  );
}

export function SidebarNav() {
  const { state, dispatch, activeTab } = useApp();
  const [special, setSpecial] = useState<Awaited<ReturnType<typeof fsApi.getSpecialDirs>> | null>(null);

  useEffect(() => {
    fsApi.getSpecialDirs().then(setSpecial).catch(() => setSpecial(null));
  }, []);

  const quickAccess = useMemo<NavItem[]>(() => {
    const out: NavItem[] = [];
    const push = (id: string, label: string, icon: React.ReactNode, path?: string | null) => {
      if (path) out.push({ id, label, icon, path });
    };
    if (state.platform.isMobile) {
      out.push({ id: 'dashboard', label: 'Dashboard', icon: <Home size={16} />, path: '/' });
    }
    push(
      'home',
      state.platform.isMobile ? 'Internal Storage' : 'Home',
      state.platform.isMobile ? <Smartphone size={16} /> : <Home size={16} />,
      state.platform.isMobile ? '/storage/emulated/0' : special?.home,
    );
    push('desktop', 'Desktop', <Laptop size={16} />, special?.desktop);
    push('downloads', 'Downloads', <Download size={16} />, special?.downloads);
    push('documents', 'Documents', <FileText size={16} />, special?.documents);
    push('pictures', 'Pictures', <Image size={16} />, special?.pictures);
    push('videos', 'Videos', <Film size={16} />, special?.videos);
    push('music', 'Music', <Music size={16} />, special?.music);
    out.push({ id: 'recent', label: 'Recent', icon: <Clock size={16} />, path: RECENT_PATH });
    if (state.platform.supportsTrash) {
      out.push({ id: 'trash', label: 'Trash', icon: <Trash2 size={16} />, path: TRASH_PATH });
    }
    return out;
  }, [special, state.platform.supportsTrash]);

  const pinnedItems = state.settings.pinnedPaths.map((p, i) => ({
    id: `pin-${i}`,
    label: p.split(/[\\/]/).filter(Boolean).pop() || p,
    icon: <Star size={16} />,
    path: p,
  }));

  const canPinActive = activeTab.path !== RECENT_PATH && !state.settings.pinnedPaths.includes(activeTab.path);

  return (
    <nav className="sidebar__nav">
      <NavSection title="Quick Access" items={quickAccess} defaultOpen={true} />

      <div className="nav-section">
        <div className="nav-section__header" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ChevronDown size={12} />
            <span>Pinned</span>
          </span>
          <button
            className="toolbar__btn"
            style={{ width: 20, height: 20 }}
            onClick={() => {
              if (!canPinActive) return;
              dispatch({
                type: 'UPDATE_SETTINGS',
                settings: { pinnedPaths: [...state.settings.pinnedPaths, activeTab.path] },
              });
            }}
            title={canPinActive ? 'Pin current folder' : 'Already pinned'}
            aria-label="Pin current folder"
            disabled={!canPinActive}
          >
            <Plus size={12} />
          </button>
        </div>
        <ul className="nav-section__list">
          {pinnedItems.length === 0 && (
            <li style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 12 }}>
              No pinned folders yet
            </li>
          )}
          {pinnedItems.map(item => (
            <li key={item.id}>
              <button
                className={`nav-item${activeTab.path === item.path ? ' nav-item--active' : ''}`}
                onClick={() => {
                  if (state.currentView !== 'files') {
                    dispatch({ type: 'SET_VIEW', view: 'files' });
                  }
                  dispatch({ type: 'NAVIGATE', path: item.path });
                  if (state.platform.isMobile) {
                    dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
                  }
                }}
                title={item.path}
              >
                <span className="nav-item__icon">{item.icon}</span>
                <span className="nav-item__label">{item.label}</span>
                <span
                  onClick={e => {
                    e.stopPropagation();
                    dispatch({
                      type: 'UPDATE_SETTINGS',
                      settings: { pinnedPaths: state.settings.pinnedPaths.filter(p => p !== item.path) },
                    });
                  }}
                  style={{ opacity: 0.7, display: 'inline-flex', alignItems: 'center' }}
                  aria-label="Remove pinned folder"
                >
                  <X size={12} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <DrivesSection />
      <CloudSection />

      {/* ── Data Pools ─────────────────────────────────── */}
      <div className="nav-section">
        <button
          className={`nav-item${
            state.currentView === 'pool' ? ' nav-item--active' : ''
          }`}
          onClick={() => {
            dispatch({ type: 'SET_VIEW', view: 'pool' });
            if (state.platform.isMobile) dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: true });
          }}
          title="Collaborative encrypted shared vaults"
          style={{ margin: '6px 8px', borderRadius: 'var(--radius-md)', width: 'calc(100% - 16px)' }}
        >
          <span className="nav-item__icon"><Database size={16} color={state.currentView === 'pool' ? 'var(--accent)' : undefined} /></span>
          <span className="nav-item__label">Data Pools</span>
        </button>
      </div>
    </nav>
  );
}
