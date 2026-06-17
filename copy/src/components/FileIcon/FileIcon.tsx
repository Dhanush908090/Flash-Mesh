import React from 'react';
import { 
  Folder, File, Image, Film, Music, Archive, FileCode, FileText, Table, Terminal, 
  FolderIcon, FileIcon as LucideFile, FileImage, FileVideo, FileAudio, FileArchive, 
  FileJson, FileSpreadsheet, Box 
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { getFileCategory } from '../../api/tauri';
import type { FileEntry } from '../../types';

interface FileIconProps {
  entry: FileEntry;
  size?: number;
}

export function FileIcon({ entry, size = 18 }: FileIconProps) {
  const { state } = useApp();
  const pkg = state.settings.iconPackage || 'rounded';
  const category = getFileCategory(entry);
  
  const isVibrant = pkg === 'vibrant';
  const isMinimal = pkg === 'minimal';
  const strokeW = pkg === 'sharp' ? 1.5 : (pkg === 'minimal' ? 1 : 2);
  const common = { size, strokeWidth: strokeW, style: { width: size, height: size } };

  const getVibrantColor = (cat: string) => {
    switch (cat) {
      case 'dir': return '#FFB300'; // Amber
      case 'image': return '#4CAF50'; // Green
      case 'video': return '#FF5252'; // Red
      case 'audio': return '#9C27B0'; // Purple
      case 'archive': return '#795548'; // Brown
      case 'code': return '#2196F3'; // Blue
      case 'text': return '#607D8B'; // Gray
      case 'data': return '#009688'; // Teal
      case 'exec': return '#E91E63'; // Pink
      default: return 'currentColor';
    }
  };

  const color = isVibrant ? getVibrantColor(entry.isDir ? 'dir' : category) : 'currentColor';
  const fill = isVibrant ? color : 'none';
  const opacity = isVibrant ? 0.9 : 1;
  const className = (!isVibrant && !isMinimal) ? `file-icon file-icon--${entry.isDir ? 'folder' : category}` : '';

  const props = { ...common, color, className };

  if (entry.isDir) return <Folder {...props} fill={fill} style={{ ...common.style, opacity }} />;
  if (category === 'image') return <FileImage {...props} />;
  if (category === 'video') return <FileVideo {...props} />;
  if (category === 'audio') return <FileAudio {...props} />;
  if (category === 'archive') return <Box {...props} />;
  if (category === 'code') return <FileCode {...props} />;
  if (category === 'text' || category === 'pdf') return <FileText {...props} />;
  if (category === 'data') return <FileSpreadsheet {...props} />;
  if (category === 'exec') return <Terminal {...props} />;
  return <LucideFile {...props} />;
}

