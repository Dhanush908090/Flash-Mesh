import type { FileEntry } from '../types';

export function getDisplayName(entry: FileEntry, showExtensions: boolean): string {
  if (entry.isDir || showExtensions) return entry.name;
  const dot = entry.name.lastIndexOf('.');
  if (dot <= 0) return entry.name;
  return entry.name.slice(0, dot);
}

export function isValidName(name: string): boolean {
  if (!name.trim()) return false;
  return !(/[\/\\:*?"<>|]/.test(name));
}

