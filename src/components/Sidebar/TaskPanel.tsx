import React, { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import {
  Loader2, CheckCircle2, XCircle, X, StopCircle,
  ChevronDown, ChevronUp, Activity,
} from 'lucide-react';
import { opsApi } from '../../api/tauri';
import { showToast } from '../Toast/Toast';
import './TaskPanel.css';

// ── Elapsed time hook ────────────────────────────────────────────────────────
function useElapsed(startTime: number, active: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime, active]);

  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

// ── Single task row ──────────────────────────────────────────────────────────
function TaskRow({ task, onCancel, onDismiss }: {
  task: { id: string; label: string; status: string; progress?: number; error?: string; startTime: number };
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const isRunning = task.status === 'running';
  const elapsed = useElapsed(task.startTime, isRunning);
  const pct = Math.min(100, Math.round(task.progress ?? 0));

  // Split label into "verb — current file" if Rust sends "Copying: somefile.txt (50%)"
  // We strip the "(50%)" suffix that was added by App.tsx's UPDATE_TASK handler and show our own
  const baseLabel = task.label.replace(/\s*\(\d+%\)\s*$/, '');
  // Split into verb + current file: "Copying: foo.mp4" → verb="Copying" detail="foo.mp4"
  const colonIdx = baseLabel.indexOf(':');
  const verb = colonIdx > 0 ? baseLabel.slice(0, colonIdx).trim() : baseLabel;
  const detail = colonIdx > 0 ? baseLabel.slice(colonIdx + 1).trim() : '';

  return (
    <div className={`task-item task-item--${task.status}`} aria-label={task.label}>
      {/* Status icon */}
      <div className="task-item__icon">
        {isRunning && <Loader2 className="animate-spin task-icon--running" size={14} />}
        {task.status === 'completed' && <CheckCircle2 size={14} className="task-icon--done" />}
        {task.status === 'failed' && <XCircle size={14} className="task-icon--fail" />}
        {task.status === 'cancelled' && <StopCircle size={14} className="task-icon--cancel" />}
      </div>

      {/* Content */}
      <div className="task-item__content">
        {/* Top row: verb + elapsed */}
        <div className="task-item__top-row">
          <span className="task-item__verb">{verb}</span>
          {isRunning && <span className="task-item__elapsed">{elapsed}</span>}
          {task.status === 'completed' && <span className="task-item__elapsed task-item__elapsed--done">Done</span>}
          {task.status === 'failed' && <span className="task-item__elapsed task-item__elapsed--fail">Failed</span>}
          {task.status === 'cancelled' && <span className="task-item__elapsed task-item__elapsed--cancel">Cancelled</span>}
        </div>

        {/* Current file being processed */}
        {detail && (
          <div className="task-item__detail" title={detail}>{detail}</div>
        )}

        {/* Progress bar + percentage */}
        {(isRunning || task.status === 'completed') && (
          <div className="task-item__progress-row">
            <div className="task-item__progress-container">
              <div
                className={`task-item__progress-bar ${task.status === 'completed' ? 'task-item__progress-bar--done' : ''}`}
                style={{ width: `${task.status === 'completed' ? 100 : pct}%` }}
              />
            </div>
            <span className="task-item__pct">
              {task.status === 'completed' ? '100' : pct}%
            </span>
          </div>
        )}

        {/* Error text */}
        {task.error && <div className="task-item__error">{task.error}</div>}
      </div>

      {/* Action button */}
      {isRunning ? (
        <button
          className="task-item__action task-item__action--cancel"
          title="Cancel"
          onClick={() => onCancel(task.id)}
        >
          <StopCircle size={13} />
        </button>
      ) : (
        <button
          className="task-item__action"
          title="Dismiss"
          onClick={() => onDismiss(task.id)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ── Main TaskPanel ────────────────────────────────────────────────────────────
export function TaskPanel() {
  const { state, dispatch } = useApp();
  const [expanded, setExpanded] = useState(true);

  // Show running tasks and recently finished (within 12s)
  const visibleTasks = state.tasks.filter(
    t => t.status === 'running' || Date.now() - t.startTime < 12000,
  );

  const runningTasks = visibleTasks.filter(t => t.status === 'running');
  const activeCount = runningTasks.length;

  // ── Total aggregate progress ──────────────────────────────────────────────
  const totalPct = (() => {
    if (visibleTasks.length === 0) return 0;
    const sum = visibleTasks.reduce((acc, t) => acc + (t.progress ?? 0), 0);
    return Math.round(sum / visibleTasks.length);
  })();

  const allDone = visibleTasks.length > 0 && visibleTasks.every(t => t.status !== 'running');

  if (visibleTasks.length === 0) return null;

  // ── Collapsed sidebar view ────────────────────────────────────────────────
  if (state.sidebarCollapsed) {
    if (activeCount === 0) return null;
    return (
      <div
        className="task-panel--collapsed"
        onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', value: false })}
        title={`${activeCount} active task${activeCount > 1 ? 's' : ''} — ${totalPct}%`}
      >
        <Loader2 className="animate-spin" size={16} />
        <span className="task-panel__badge">{activeCount}</span>
        {/* Mini ring progress */}
        <svg className="task-panel__ring" viewBox="0 0 36 36" width={40} height={40}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="2.5" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke="var(--accent)" strokeWidth="2.5"
            strokeDasharray={`${(totalPct / 100) * 94.2} 94.2`}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
            style={{ transition: 'stroke-dasharray 0.4s ease' }}
          />
        </svg>
      </div>
    );
  }

  // ── Expanded sidebar view ─────────────────────────────────────────────────
  const handleCancel = async (id: string) => {
    try {
      await opsApi.cancelOperation(id);
      dispatch({ type: 'UPDATE_TASK', id, updates: { status: 'cancelled' } });
      showToast({ message: 'Task cancelled' });
    } catch (e: any) {
      showToast({ message: `Cancel failed: ${e}` });
    }
  };

  const handleDismiss = (id: string) => dispatch({ type: 'REMOVE_TASK', id });

  const handleClearDone = () => {
    state.tasks
      .filter(t => t.status !== 'running')
      .forEach(t => dispatch({ type: 'REMOVE_TASK', id: t.id }));
  };

  return (
    <div className="task-panel">
      {/* ── Header ── */}
      <div className="task-panel__header">
        <div className="task-panel__header-left">
          <Activity size={12} />
          <span>
            {activeCount > 0
              ? `${activeCount} Task${activeCount > 1 ? 's' : ''} Running`
              : 'Tasks'}
          </span>
        </div>
        <div className="task-panel__header-right">
          {allDone && (
            <button className="task-panel__clear" onClick={handleClearDone}>
              Clear
            </button>
          )}
          <button
            className="task-panel__toggle"
            onClick={() => setExpanded(e => !e)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* ── Total Progress Bar ── */}
      <div className="task-panel__total">
        <div className="task-panel__total-bar-wrap">
          <div
            className={`task-panel__total-bar ${allDone ? 'task-panel__total-bar--done' : ''}`}
            style={{ width: `${allDone ? 100 : totalPct}%` }}
          />
        </div>
        <span className="task-panel__total-pct">
          {allDone ? <CheckCircle2 size={13} /> : `${totalPct}%`}
        </span>
      </div>

      {/* ── Per-task list ── */}
      {expanded && (
        <div className="task-panel__list">
          {visibleTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onCancel={handleCancel}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
