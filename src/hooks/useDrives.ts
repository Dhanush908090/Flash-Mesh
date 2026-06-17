import { useState, useEffect } from 'react';
import { drivesApi } from '../api/tauri';
import { useApp } from '../store/AppContext';
import type { DriveInfo } from '../types';

export function useDrives() {
  const { state } = useApp();
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!state.platform.supportsDrives) {
      setDrives([]);
      setLoading(false);
      return;
    }

    drivesApi.getDrives()
      .then(setDrives)
      .catch(() => setDrives([]))
      .finally(() => setLoading(false));

    // Refresh every 5 seconds
    const interval = setInterval(() => {
      drivesApi.getDrives().then(setDrives).catch(() => {});
    }, 5000);

    return () => clearInterval(interval);
  }, [state.platform.supportsDrives]);

  return { drives, loading };
}

export function formatDiskSize(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

export function getDriveIcon(drive: DriveInfo): string {
  if (drive.isRemovable) return 'removable';
  if (drive.driveType?.toLowerCase().includes('hdd')) return 'hard-drive';
  return 'drive';
}
