import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FileEntry, DriveInfo } from '../types';
import { joinPathLocal } from '../utils/path';

// ─── Types mirroring Rust structs ────────────────────────────────────────────

export interface DirListing {
  path: string;
  entries: FileEntry[];
  parent: string | null;
  error: string | null;
}

export interface ProgressEvent {
  operationId: string;
  label: string;
  current: number;
  total: number;
  percent: number;
}

export interface SearchResult {
  entry: FileEntry;
  matchScore: number;
}

export interface SpecialDirs {
  home: string | null;
  desktop: string | null;
  downloads: string | null;
  documents: string | null;
  pictures: string | null;
  videos: string | null;
  music: string | null;
}

export interface PlatformCapabilities {
  os: string;
  family: string;
  isMobile: boolean;
  supportsDrives: boolean;
  supportsTrash: boolean;
  supportsTerminal: boolean;
  supportsOpenWith: boolean;
  filesystemScope: 'native-filesystem' | 'app-sandbox' | string;
}

// ─── Cross-platform path utilities ───────────────────────────────────────────

let _sep: string | null = null;

export async function getPathSep(): Promise<string> {
  if (_sep) return _sep;
  _sep = await invoke<string>('path_separator');
  return _sep;
}

/** Join two path segments using the OS path separator from Rust */
export async function joinPath(base: string, name: string): Promise<string> {
  return invoke<string>('path_join', { base, name });
}

/** Synchronous path join using detected separator */
export function joinPathSync(base: string, name: string): string {
  return joinPathLocal(base, name);
}

// ─── Filesystem ───────────────────────────────────────────────────────────────

export const fsApi = {
  // Tauri command arguments are camelCased from Rust snake_case params.
  listDirectory: (path: string, showHidden = false): Promise<DirListing> =>
    invoke('list_directory', { path, showHidden }),

  getHomeDir: (): Promise<string> =>
    invoke('get_home_dir'),

  getSpecialDirs: (): Promise<SpecialDirs> =>
    invoke('get_special_dirs'),

  getFileMetadata: (path: string): Promise<FileEntry | null> =>
    invoke('get_file_metadata', { path }),

  listTrash: (): Promise<DirListing> =>
    invoke('list_trash'),
};

// ─── File Operations ──────────────────────────────────────────────────────────

export const opsApi = {
  copyItems: (sources: string[], destination: string, operationId: string): Promise<void> =>
    invoke('copy_items', { sources, destination, operationId }),

  moveItems: (sources: string[], destination: string, operationId: string): Promise<void> =>
    invoke('move_items', { sources, destination, operationId }),

  renameItem: (path: string, newName: string): Promise<string> =>
    invoke('rename_item', { path, newName }),

  deleteItems: (paths: string[], permanent = false): Promise<void> =>
    invoke('delete_items', { paths, permanent }),

  createFolder: (path: string): Promise<void> =>
    invoke('create_folder', { path }),

  createFile: (path: string): Promise<void> =>
    invoke('create_file', { path }),

  readTextFile: (path: string, maxBytes = 65536): Promise<string> =>
    invoke('read_text_file', { path, maxBytes }),

  readBinaryFile: (path: string): Promise<Uint8Array> =>
    invoke('read_binary_file', { path }),

  writeBinaryFile: (path: string, contents: number[] | Uint8Array): Promise<void> =>
    invoke('write_binary_file', { path, contents: Array.from(contents) }),

  openItem: (path: string): Promise<void> =>
    invoke('open_item', { path }),

  openItemWith: (path: string): Promise<void> =>
    invoke('open_item_with', { path }),

  emptyTrash: (): Promise<void> =>
    invoke('empty_trash'),

  cancelOperation: (operationId: string): Promise<void> =>
    invoke('cancel_operation', { operationId }),
};

// ─── Search ───────────────────────────────────────────────────────────────────

export const searchApi = {
  searchFiles: (
    rootPath: string,
    query: string,
    showHidden = false,
    limit = 100,
  ): Promise<SearchResult[]> =>
    invoke('search_files', { rootPath, query, showHidden, limit }),

  listRecentFiles: (
    paths: string[],
    showHidden = false,
    limit = 200,
  ): Promise<FileEntry[]> =>
    invoke('list_recent_files', { paths, showHidden, limit }),
};

// ─── Virtual Paths ────────────────────────────────────────────────────────────

export const VirtualPaths = {
  RECENT: '__recent__',
  TRASH: '__trash__',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Drives ───────────────────────────────────────────────────────────────────

export const drivesApi = {
  getDrives: (): Promise<DriveInfo[]> =>
    invoke('get_drives'),
};

// ─── Platform ────────────────────────────────────────────────────────────────

export const platformApi = {
  getCapabilities: (): Promise<PlatformCapabilities> =>
    invoke('get_platform_capabilities'),
  checkAndroidPermission: (): Promise<boolean> =>
    invoke('check_android_permission'),
  requestAndroidPermission: (): Promise<void> =>
    invoke('request_android_permission'),
};

// ─── Terminal ────────────────────────────────────────────────────────────────

export const terminalApi = {
  openTerminal: (path: string): Promise<void> =>
    invoke('open_terminal', { path }),
};

// ─── Sharing & Streaming ───────────────────────────────────────────────────────

export function start_share_server(path: string): Promise<string> {
  return invoke('start_share_server', { path });
}

export function stop_share_server(): Promise<void> {
  return invoke('stop_share_server');
}

export function get_share_status(): Promise<string | null> {
  return invoke('get_share_status');
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function onFileOperationProgress(
  cb: (event: ProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<ProgressEvent>('file-operation-progress', e => cb(e.payload));
}

// ─── File icon helper ─────────────────────────────────────────────────────────

export type FileCategory =
  | 'folder' | 'image' | 'video' | 'audio' | 'pdf'
  | 'code' | 'text' | 'archive' | 'exec' | 'data' | 'other';

export function getFileCategory(entry: FileEntry): FileCategory {
  if (entry.isDir) return 'folder';
  const ext = (entry.extension || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','heic'].includes(ext)) return 'image';
  if (['mp4','mkv','mov','avi','webm','flv','wmv','m4v'].includes(ext)) return 'video';
  if (['mp3','flac','wav','aac','ogg','m4a','opus','wma'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['zip','tar','gz','rar','7z','bz2','xz','zst','tar.gz','tar.xz'].includes(ext)) return 'archive';
  if (['rs','ts','tsx','js','jsx','py','go','cpp','c','h','java','kt','swift','rb','php',
       'css','html','json','toml','yaml','yml','sh','bash','zsh','fish','lua','vim'].includes(ext)) return 'code';
  if (['txt','md','mdx','rst','log','csv','nfo','rtf','doc','docx'].includes(ext)) return 'text';
  if (['exe','bin','AppImage','deb','rpm','msi','dmg','apk'].includes(ext)) return 'exec';
  if (['db','sqlite','sql','json','xml','csv'].includes(ext)) return 'data';
  return 'other';
}

const CATEGORY_ICONS: Record<FileCategory, string> = {
  folder:  'Folder',
  image:   'Image',
  video:   'Video',
  audio:   'Audio',
  pdf:     'PDF',
  archive: 'Archive',
  code:    'Code',
  text:    'Text',
  exec:    'App',
  data:    'Data',
  other:   'File',
};

export function getFileIcon(entry: FileEntry): string {
  return CATEGORY_ICONS[getFileCategory(entry)];
}

export const CATEGORY_COLOR: Record<FileCategory, string> = {
  folder:  'var(--color-folder)',
  image:   'var(--color-image)',
  video:   'var(--color-video)',
  audio:   'var(--color-audio)',
  pdf:     'var(--color-pdf)',
  archive: 'var(--color-archive)',
  code:    'var(--color-code)',
  text:    'var(--color-text)',
  exec:    'var(--color-exec)',
  data:    'var(--color-data)',
  other:   'var(--text-muted)',
};

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.valueOf())) return dateStr;
  return d.toLocaleString();
}

export function formatDiskSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ─── Data Pools API ───────────────────────────────────────────────────────────

export interface PoolMember {
  fingerprint: string;
  nickname: string;
  joined_at: string;
  quota_bytes: number;
}

export interface DataPool {
  id: string;
  name: string;
  owner_fp: string;
  hub_folder_id: string;
  inbox_folder_id: string;
  members: PoolMember[];
  total_size: number;
  used_size: number;
  status: string;
  created_at: string;
}

export interface InboxProcessResult {
  processed_count: number;
  failed_count: number;
  errors: string[];
}

export const poolApi = {
  listPools: (): Promise<DataPool[]> =>
    invoke('list_pools'),

  createPool: (name: string, hubFolderId: string): Promise<DataPool> =>
    invoke('create_pool', { name, hubFolderId }),

  processPoolInbox: (poolId: string, proposals: any[], currentManifestJson: string): Promise<[string, InboxProcessResult]> =>
    invoke('process_pool_inbox', { poolId, proposals, currentManifestJson }),

  generatePoolInvite: (poolId: string, hubFolderId: string): Promise<string> =>
    invoke('generate_pool_invite', { poolId, hubFolderId }),

  joinPoolFromInvite: (inviteLink: string): Promise<DataPool> =>
    invoke('join_pool_from_invite', { inviteLink }),
};

export function get_image_thumbnail(path: string): Promise<string> {
  return invoke('get_image_thumbnail', { path });
}

export function get_extended_metadata(path: string): Promise<any> {
  return invoke('get_extended_metadata', { path });
}

