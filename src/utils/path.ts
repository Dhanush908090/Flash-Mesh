export const RECENT_PATH = '__recent__';
export const TRASH_PATH = '__trash__';

export function isVirtualPath(path: string): boolean {
  return path === RECENT_PATH || path === TRASH_PATH;
}

function hasWindowsDrive(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path);
}

function isUncPath(path: string): boolean {
  return path.startsWith('\\\\');
}

function separatorFor(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function normalizePath(path: string): string {
  if (!path) return '/';
  if (isVirtualPath(path)) return path;
  let p = path;
  if (!p) return '/';

  const sep = separatorFor(p);
  p = sep === '/' ? p.replace(/\\/g, '/') : p.replace(/\//g, '\\');

  if (sep === '\\' && p.startsWith('\\\\')) {
    p = `\\\\${p.slice(2).replace(/\\{2,}/g, '\\')}`;
  } else {
    p = p.replace(/[\\/]{2,}/g, sep);
  }

  if (/^[A-Za-z]:$/.test(p)) return `${p}${sep}`;
  if (p.length > 1 && !/^[A-Za-z]:[\\/]$/.test(p)) {
    p = p.replace(/[\\/]+$/, '');
  }
  return p;
}

export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (isVirtualPath(normalized)) return normalized;
  if (normalized === '/') return '/';
  if (/^[A-Za-z]:[\\/]$/.test(normalized)) return normalized;
  const sep = separatorFor(normalized);
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx <= 0) return hasWindowsDrive(normalized) ? `${normalized.slice(0, 2)}${sep}` : '/';
  if (isUncPath(normalized)) {
    const parts = normalized.split('\\').filter(Boolean);
    if (parts.length <= 2) return normalized;
  }
  return normalized.slice(0, idx);
}

export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === RECENT_PATH) return 'Recent';
  if (normalized === TRASH_PATH) return 'Trash';
  if (normalized === '/') return 'Root';
  if (/^[A-Za-z]:[\\/]$/.test(normalized)) return normalized.slice(0, 2);
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function joinPathLocal(base: string, name: string): string {
  if (!base || isVirtualPath(base)) return base;
  const normalizedBase = normalizePath(base);
  const sep = separatorFor(normalizedBase);
  return normalizePath(`${normalizedBase.replace(/[\\/]+$/, '')}${sep}${name.replace(/^[\\/]+/, '')}`);
}

export function splitPath(path: string): { name: string; path: string }[] {
  const current = normalizePath(path);
  if (current === RECENT_PATH) return [{ name: 'Recent', path: RECENT_PATH }];
  if (current === TRASH_PATH) return [{ name: 'Trash', path: TRASH_PATH }];
  if (current === '/') return [{ name: 'Root', path: '/' }];

  if (isUncPath(current)) {
    const parts = current.split('\\').filter(Boolean);
    if (parts.length < 2) return [{ name: current, path: current }];
    const root = `\\\\${parts[0]}\\${parts[1]}\\`;
    const crumbs = [{ name: `\\\\${parts[0]}\\${parts[1]}`, path: root }];
    let cursor = root;
    for (const segment of parts.slice(2)) {
      cursor = joinPathLocal(cursor, segment);
      crumbs.push({ name: segment, path: cursor });
    }
    return crumbs;
  }

  const sep = separatorFor(current);
  const isWindows = hasWindowsDrive(current);
  const root = isWindows ? `${current.slice(0, 2)}${sep}` : '/';
  const rootName = isWindows ? current.slice(0, 2) : 'Root';
  const tail = isWindows ? current.slice(3) : current.slice(1);
  const segs = tail.split(/[\\/]/).filter(Boolean);
  const crumbs = [{ name: rootName, path: root }];
  let cursor = root;

  for (const segment of segs) {
    cursor = joinPathLocal(cursor, segment);
    crumbs.push({ name: segment, path: cursor });
  }

  return crumbs;
}
