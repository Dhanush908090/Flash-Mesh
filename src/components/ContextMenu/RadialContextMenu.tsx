import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { FileEntry } from '../../types';

interface OmnitrixMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

interface RadialContextMenuProps {
  x: number;
  y: number;
  items: OmnitrixMenuItem[];
  onClose: () => void;
}

const RADIUS = 72; // px from center to item center

export function RadialContextMenu({ x, y, items, onClose }: RadialContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // ── Position computation: keep the menu inside the viewport ──────────────
  const menuLeft = Math.min(Math.max(x, RADIUS + 20), window.innerWidth - RADIUS - 20);
  const menuTop  = Math.min(Math.max(y, RADIUS + 20), window.innerHeight - RADIUS - 20);

  // ── Distribute items evenly on a circle ──────────────────────────────────
  const count = items.length;
  const itemPositions = items.map((_, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    return {
      x: Math.cos(angle) * RADIUS,
      y: Math.sin(angle) * RADIUS,
      angle,
    };
  });

  // ── Mouse-move → highlight nearest item ─────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);

    // Only activate item if mouse is outside the center circle (>20px)
    if (dist < 20) {
      setActiveIndex(null);
      return;
    }

    const cursorAngle = Math.atan2(dy, dx);
    let bestIndex = 0;
    let bestDiff = Infinity;
    itemPositions.forEach((pos, i) => {
      let diff = Math.abs(cursorAngle - pos.angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    });
    setActiveIndex(bestIndex);
  }, [itemPositions]);

  // ── Arrow key navigation ─────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter' && activeIndex !== null) {
      items[activeIndex].action();
      onClose();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => prev === null ? 0 : (prev + 1) % count);
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => prev === null ? count - 1 : (prev - 1 + count) % count);
    }
  }, [activeIndex, count, items, onClose]);

  // ── Click outside → close ────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    if (!containerRef.current?.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    // Use capture so we intercept before other listeners; use setTimeout so
    // the same right-click that opened the menu does not immediately close it
    const t = setTimeout(() => window.addEventListener('click', handleClick), 0);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('click', handleClick);
      clearTimeout(t);
    };
  }, [handleMouseMove, handleKeyDown, handleClick]);

  return (
    <div
      id="omnitrix-menu"
      ref={containerRef}
      style={{ left: menuLeft, top: menuTop }}
      onContextMenu={e => { e.preventDefault(); onClose(); }}
    >
      {/* Decorative background glow */}
      <div className="omnitrix-bg" />

      {/* Spinning dashed ring */}
      <div className="omnitrix-ring" />

      {/* Center node */}
      <div className="omnitrix-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
      </div>

      {/* Radial items */}
      {items.map((item, i) => {
        const pos = itemPositions[i];
        const isActive = activeIndex === i;
        return (
          <button
            key={item.id}
            className={[
              'omnitrix-item',
              isActive ? 'omnitrix-item--active' : '',
              item.danger ? 'omnitrix-item--danger' : '',
              item.disabled ? 'omnitrix-item--disabled' : '',
            ].filter(Boolean).join(' ')}
            style={{
              '--omni-x': `${pos.x}px`,
              '--omni-y': `${pos.y}px`,
            } as React.CSSProperties}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
            title={item.label}
          >
            {item.icon}
            <span className="omnitrix-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Menu builder helper — same items interface as flat ContextMenu ────────────
export interface RadialContextMenuItems {
  items: OmnitrixMenuItem[];
}
