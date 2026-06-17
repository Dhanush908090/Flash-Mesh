import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Folder, File, HardDrive, RefreshCw } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { fsApi } from '../../api/tauri';
import type { FileEntry, FileFilters } from '../../types';
import { getBaseName } from '../../utils/path';

// Category helper
export function getFileTypeCategory(ext: string | null): string {
  if (!ext) return 'other';
  const e = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'heic'].includes(e)) return 'image';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'].includes(e)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'].includes(e)) return 'audio';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'odt', 'ods'].includes(e)) return 'document';
  if (['ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'py', 'c', 'cpp', 'h', 'html', 'css', 'json', 'yaml', 'toml', 'sh', 'bat', 'ps1', 'xml'].includes(e)) return 'code';
  return 'other';
}

export function FileTree() {
  const { activeTab, navigate, state, dispatch } = useApp();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadedDirs, setLoadedDirs] = useState<Record<string, FileEntry[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  const rootPath = activeTab.path;
  const filters = state.filters;
  const showHidden = state.settings.showHiddenFiles;

  // Reset expansion and loaded dirs when root changes radically
  useEffect(() => {
    // Keep root path pre-loaded
    if (rootPath && !rootPath.startsWith('mesh://') && !rootPath.startsWith('pool://') && rootPath !== '__recent__' && rootPath !== '__trash__') {
      loadDirectoryContents(rootPath);
    }
  }, [rootPath, showHidden]);

  const loadDirectoryContents = async (path: string) => {
    if (loadingPaths.has(path)) return;
    setLoadingPaths(prev => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });

    try {
      const data = await fsApi.listDirectory(path, showHidden);
      if (!data.error) {
        setLoadedDirs(prev => ({
          ...prev,
          [path]: data.entries
        }));
      }
    } catch (err) {
      console.error('Failed to load tree node:', path, err);
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const handleToggleExpand = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      if (!loadedDirs[path]) {
        await loadDirectoryContents(path);
      }
    }
    setExpandedPaths(newExpanded);
  };

  const handleNodeClick = (entry: FileEntry) => {
    if (entry.isDir) {
      navigate(entry.path);
    } else {
      dispatch({ type: 'SET_SELECTION', ids: new Set([entry.id]) });
    }
  };

  // Check if a file matches current filters
  const fileMatchesFilters = useCallback((entry: FileEntry, currentFilters: FileFilters) => {
    if (entry.isDir) return false;
    
    // File type match
    if (currentFilters.types.length > 0) {
      const cat = getFileTypeCategory(entry.extension);
      if (!currentFilters.types.includes(cat)) return false;
    }

    // Month match
    if (currentFilters.months.length > 0) {
      if (!entry.modified) return false;
      const month = entry.modified.substring(5, 7); // YYYY-MM
      if (!currentFilters.months.includes(month)) return false;
    }

    return true;
  }, []);

  // Check recursively if a loaded folder or its loaded children contain matches
  const nodeHasMatches = useCallback((path: string, currentFilters: FileFilters): boolean => {
    const entries = loadedDirs[path];
    if (!entries) return true; // Keep unloaded folders visible so user can load them
    if (currentFilters.months.length === 0 && currentFilters.types.length === 0) return true;

    return entries.some(entry => {
      if (entry.isDir) {
        // Recurse down loaded subfolders
        return nodeHasMatches(entry.path, currentFilters);
      } else {
        return fileMatchesFilters(entry, currentFilters);
      }
    });
  }, [loadedDirs, fileMatchesFilters]);

  // Recursively render node children
  const renderTreeNodes = (dirPath: string, depth: number) => {
    const entries = loadedDirs[dirPath] || [];
    const sorted = [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const isFiltersActive = filters.months.length > 0 || filters.types.length > 0;

    return sorted
      .filter(entry => {
        if (entry.isDir) {
          // Keep folders only if they have matches inside loaded descendants or are unloaded
          return nodeHasMatches(entry.path, filters);
        } else {
          // Keep files only if they match the active filters
          return !isFiltersActive || fileMatchesFilters(entry, filters);
        }
      })
      .map(entry => {
        const isExpanded = expandedPaths.has(entry.path);
        const isLoading = loadingPaths.has(entry.path);
        const isSelected = activeTab.path === entry.path || (activeTab.selection.has(entry.id));

        return (
          <div key={entry.id} className="tree-node-wrapper">
            <div 
              className={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => handleNodeClick(entry)}
            >
              {entry.isDir ? (
                <button 
                  className="tree-node__arrow" 
                  onClick={(e) => handleToggleExpand(e, entry.path)}
                >
                  {isLoading ? (
                    <RefreshCw size={10} className="animate-spin text-blue-400" />
                  ) : isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
              ) : (
                <span className="tree-node__arrow-placeholder" />
              )}

              <span className="tree-node__icon">
                {entry.isDir ? (
                  <Folder size={14} className="text-amber-400 fill-amber-400" />
                ) : (
                  <File size={14} className="text-blue-300" />
                )}
              </span>

              <span className="tree-node__name" title={entry.name}>
                {entry.name}
              </span>
            </div>

            {entry.isDir && isExpanded && loadedDirs[entry.path] && (
              <div className="tree-node__children">
                {renderTreeNodes(entry.path, depth + 1)}
              </div>
            )}
          </div>
        );
      });
  };

  const isNavigable = rootPath && !rootPath.startsWith('mesh://') && !rootPath.startsWith('pool://') && rootPath !== '__recent__' && rootPath !== '__trash__';

  if (state.sidebarCollapsed) return null;

  return (
    <div className="nav-section file-tree-section">
      <div className="nav-section__header">
        <HardDrive size={12} />
        <span>Workspace Tree</span>
      </div>
      
      <div className="file-tree-scroll">
        {isNavigable ? (
          <div className="tree-root">
            <div 
              className={`tree-node tree-node--root ${activeTab.path === rootPath ? 'tree-node--selected' : ''}`}
              onClick={() => navigate(rootPath)}
            >
              <Folder size={14} className="text-amber-500 fill-amber-500" />
              <span className="tree-node__name font-semibold">
                {getBaseName(rootPath) || 'Root'}
              </span>
            </div>
            <div className="tree-node__children">
              {renderTreeNodes(rootPath, 1)}
            </div>
          </div>
        ) : (
          <div className="tree-node__placeholder">
            Tree view unavailable for this location.
          </div>
        )}
      </div>
    </div>
  );
}
