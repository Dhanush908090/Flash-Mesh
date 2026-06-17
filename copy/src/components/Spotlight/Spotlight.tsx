import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { searchApi } from '../../api/tauri';
import { useApp } from '../../store/AppContext';
import type { SearchResult } from '../../api/tauri';
import { FileIcon } from '../FileIcon/FileIcon';

interface SpotlightProps {
  onClose: () => void;
}

export function Spotlight({ onClose }: SpotlightProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { navigate, activeTab } = useApp();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    searchApi.searchFiles('/', q, false, 50)
      .then(r => { setResults(r); setHighlightIdx(0); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const openResult = (result: SearchResult) => {
    if (result.entry.isDir) {
      navigate(result.entry.path);
    } else {
      navigate(result.entry.path.substring(0, result.entry.path.lastIndexOf('/')));
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[highlightIdx]) { openResult(results[highlightIdx]); }
  };

  return (
    <div className="spotlight-backdrop" onClick={onClose}>
      <div className="spotlight" onClick={e => e.stopPropagation()}>
        <div className="spotlight__input-row">
          <Search size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="spotlight__input"
            placeholder="Search everywhere…"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Searching…</span>}
          <button className="toolbar__btn" onClick={onClose}><X size={16} /></button>
        </div>

        {results.length > 0 && (
          <div className="spotlight__results">
            {results.map((r, i) => (
              <div
                key={r.entry.id}
                className={`spotlight__result${i === highlightIdx ? ' spotlight__result--highlighted' : ''}`}
                onClick={() => openResult(r)}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                <span className="spotlight__result__icon"><FileIcon entry={r.entry} size={18} /></span>
                <div className="spotlight__result__info">
                  <div className="spotlight__result__name">{r.entry.name}</div>
                  <div className="spotlight__result__path">{r.entry.path}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {query && !loading && results.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No results for "{query}"
          </div>
        )}

        <div className="spotlight__footer">
          <span className="spotlight__kbd"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="spotlight__kbd"><kbd>Enter</kbd> open</span>
          <span className="spotlight__kbd"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
