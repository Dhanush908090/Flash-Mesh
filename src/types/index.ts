// ─── Core File Types ───────────────────────────────────────────────────────────

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: string | null;
  created: string | null;
  extension: string | null;
  isHidden: boolean;
  isSymlink: boolean;
  mimeType: string | null;
}

export interface DriveInfo {
  name: string;
  devicePath: string;
  mountPoint: string | null;
  isMounted: boolean;
  totalSpace: number;
  availableSpace: number;
  usedSpace: number;
  driveType: string;
  fileSystem: string;
  isRemovable: boolean;
}

export interface PlatformCapabilities {
  os: string;
  family: string;
  isMobile: boolean;
  supportsDrives: boolean;
  supportsTrash: boolean;
  supportsTerminal: boolean;
  supportsOpenWith: boolean;
  filesystemScope: string;
}


export interface BreadcrumbItem {
  name: string;
  path: string;
}

export type ViewMode = 'grid' | 'list' | 'compact';
export type SortField = 'name' | 'size' | 'modified' | 'type';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  label: string;
  scrollPosition: number;
  selection: Set<string>;
  viewMode: ViewMode;
  sortConfig: SortConfig;
  selectionPivot: string | null;
  lastUpdated: number;
}

export interface Task {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  error?: string;
  startTime: number;
}

export interface ClipboardState {
  items: FileEntry[];
  operation: 'copy' | 'cut' | null;
}

export interface FileOperation {
  id: string;
  kind: 'rename' | 'move' | 'create' | 'delete';
  undo: {
    type: 'rename' | 'move' | 'delete';
    sources?: string[];
    destination?: string;
    path?: string;
    newName?: string;
  };
  redo: {
    type: 'rename' | 'move' | 'delete';
    sources?: string[];
    destination?: string;
    path?: string;
    newName?: string;
  };
  label: string;
  timestamp: number;
}

export interface SearchResult {
  entry: FileEntry;
  matchScore: number;
}

export interface AppSettings {
  defaultView: ViewMode;
  showHiddenFiles: boolean;
  showFileExtensions: boolean;
  theme: 'dark' | 'light' | 'system';
  confirmBeforeDelete: boolean;
  startupFolder: string;
  sidebarWidth: number;
  pinnedPaths: string[];
  hoverOpenItems: boolean;
  hoverOpenDelay: number;
  recentHistoryLimit: number;
  recentHistory: string[];
  iconPackage: 'rounded' | 'sharp' | 'vibrant' | 'minimal';
  autoErrorReporting: boolean;
  userEmail: string;
  dragDropAction: 'ask' | 'move' | 'copy';
}

export type DialogType =
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entries: FileEntry[]; permanent: boolean }
  | { kind: 'newFolder'; parentPath: string }
  | { kind: 'properties'; entry: FileEntry }
  | { kind: 'dragDrop'; sourcePaths: string[]; destination: string }
  | { kind: 'none' };

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetEntries: FileEntry[];
  isBackground: boolean;
}
