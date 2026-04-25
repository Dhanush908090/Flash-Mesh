import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface Toast {
  id: string;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
  duration?: number;
}

let toastListeners: Array<(toasts: Toast[]) => void> = [];
let currentToasts: Toast[] = [];

function notifyListeners() {
  toastListeners.forEach(cb => cb([...currentToasts]));
}

export function showToast(toast: Omit<Toast, 'id'>) {
  const id = crypto.randomUUID();
  const t: Toast = { id, duration: 4000, ...toast };
  currentToasts = [...currentToasts, t];
  notifyListeners();

  setTimeout(() => {
    currentToasts = currentToasts.filter(x => x.id !== id);
    notifyListeners();
  }, t.duration);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListeners.push(setToasts);
    return () => { toastListeners = toastListeners.filter(cb => cb !== setToasts); };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.onUndo && (
            <button
              className="toast__undo"
              onClick={() => {
                t.onUndo?.();
                currentToasts = currentToasts.filter(x => x.id !== t.id);
                notifyListeners();
              }}
            >
              {t.undoLabel || 'Undo'}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}
