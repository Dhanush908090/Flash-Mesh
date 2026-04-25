import { useState, useCallback, useRef } from 'react';

const DRAG_THRESHOLD = 8; // px — must move this far before selection box appears

export function useDragSelect(onSelectionChange: (selectedIds: Set<string>) => void) {
  const [dragBox, setDragBox] = useState<{ startX: number, startY: number, curX: number, curY: number } | null>(null);
  const isDragging = useRef(false);      // pointer is held down
  const isSelecting = useRef(false);     // threshold crossed — box is visible
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastDispatchedIds = useRef<Set<string>>(new Set());

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;

    // Never start selection on interactive elements or chrome areas
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a') ||
      target.closest('.file-card') ||
      target.closest('.file-row') ||
      target.closest('.file-compact-row') ||
      target.closest('.breadcrumb') ||
      target.closest('.location-bar') ||
      target.closest('.toolbar') ||
      target.closest('.tab-bar') ||
      target.closest('.sidebar') ||
      target.closest('.status-bar') ||
      target.closest('.dialog-backdrop') ||
      target.closest('[role="dialog"]')
    ) return;

    // Don't preventDefault yet — wait for threshold so plain clicks still work normally
    isDragging.current = true;
    isSelecting.current = false;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    startPos.current = { x, y };

    const el = e.currentTarget as HTMLElement;
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const { x: startX, y: startY } = startPos.current;

    // Only cross into selection mode after threshold
    if (!isSelecting.current) {
      const distX = Math.abs(curX - startX);
      const distY = Math.abs(curY - startY);
      if (distX < DRAG_THRESHOLD && distY < DRAG_THRESHOLD) return;
      isSelecting.current = true;
      document.body.classList.add('is-dragging');
      e.preventDefault();
    }

    setDragBox(() => {
      const newBox = { startX, startY, curX, curY };

      const left   = Math.min(startX, curX);
      const right  = Math.max(startX, curX);
      const top    = Math.min(startY, curY);
      const bottom = Math.max(startY, curY);

      const gLeft   = left   + rect.left;
      const gRight  = right  + rect.left;
      const gTop    = top    + rect.top;
      const gBottom = bottom + rect.top;

      const selectedIds = new Set<string>();
      document.querySelectorAll('[data-id]').forEach(item => {
        const ir = item.getBoundingClientRect();
        if (ir.right > gLeft && ir.left < gRight && ir.bottom > gTop && ir.top < gBottom) {
          const id = item.getAttribute('data-id');
          if (id) selectedIds.add(id);
        }
      });

      if (
        selectedIds.size !== lastDispatchedIds.current.size ||
        [...selectedIds].some(id => !lastDispatchedIds.current.has(id))
      ) {
        lastDispatchedIds.current = selectedIds;
        onSelectionChange(selectedIds);
      }

      return newBox;
    });
  }, [onSelectionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;

    const wasSelecting = isSelecting.current;
    isDragging.current = false;
    isSelecting.current = false;
    document.body.classList.remove('is-dragging');

    if (!wasSelecting) {
      // Threshold never crossed — plain click on empty area → clear selection
      onSelectionChange(new Set());
    }

    lastDispatchedIds.current = new Set();
    setDragBox(null);

    const target = e.target as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  }, [onSelectionChange]);

  const handlePointerCancel = useCallback(() => {
    isDragging.current = false;
    isSelecting.current = false;
    document.body.classList.remove('is-dragging');
    setDragBox(null);
  }, []);

  const dragStyles: React.CSSProperties | undefined = dragBox ? {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate(${Math.min(dragBox.startX, dragBox.curX)}px, ${Math.min(dragBox.startY, dragBox.curY)}px)`,
    width:  Math.abs(dragBox.curX - dragBox.startX),
    height: Math.abs(dragBox.curY - dragBox.startY),
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    border: '1.5px solid rgba(99, 102, 241, 0.75)',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: 9999,
    boxShadow: '0 0 12px rgba(99, 102, 241, 0.15)',
  } : undefined;

  return {
    handlers: {
      onPointerDown:   handlePointerDown,
      onPointerMove:   handlePointerMove,
      onPointerUp:     handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
    dragStyles,
  };
}
