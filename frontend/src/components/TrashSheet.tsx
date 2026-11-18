import { useEffect, useRef, useState } from 'react';
import { startDialogDismiss } from '../lib/dialogDismiss';
import { formatRelativeTime } from '../lib/relativeTime';
import { trashDaysLeft } from '../lib/absoluteTime';
import { TRASH_TTL_MS } from '../lib/chatTrash';
import type { TrashEntry } from '../lib/chatTrash';
import ConfirmDialog from './ConfirmDialog';
import './TrashSheet.css';

interface Props {
  open: boolean;
  entries: TrashEntry[];
  onClose: () => void;
  onRestore: (sessionId: string) => void;
  onClearAll: () => void;
}

/**
 * P265 — recycle-bin panel. Same dialog language as SettingsSheet (centred
 * overlay panel on the same tokens and shared .settings-* shell classes):
 * one row per deleted conversation with 标题 · N 条消息 · 删除于 X and a
 * per-row 恢复, a 清空回收站 danger action behind the shared ConfirmDialog
 * (.confirm-overlay/.confirm-panel), and the standing retention note.
 */
export default function TrashSheet({
  open,
  entries,
  onClose,
  onRestore,
  onClearAll,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(open);
  const [confirmingClear, setConfirmingClear] = useState(false);
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open;
    // Same pattern as SettingsSheet (P136): capture the trigger so focus
    // returns to the 回收站 row when the sheet closes.
    openerRef.current = open ? document.activeElement : null;
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
    const handle = startDialogDismiss({
      onClose,
      getPanel: () => panelRef.current,
      opener: openerRef.current,
    });
    return () => handle.stop();
  }, [open, onClose]);

  if (!open) return null;

  // P329: one snapshot per render so every row's 「剩 N 天」 agrees.
  const now = Date.now();

  return (
    <div
      className="settings-overlay trash-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trash-title"
    >
      <div className="settings-panel trash-panel" ref={panelRef}>
        <button
          type="button"
          className="settings-close"
          onClick={onClose}
          aria-label="关闭回收站"
          title="关闭"
        >
          ×
        </button>
        <h2 id="trash-title" className="settings-title">
          回收站
        </h2>

        {entries.length === 0 ? (
          <p className="trash-empty" role="status">
            回收站是空的
          </p>
        ) : (
          <ul className="trash-list" aria-label="已删除对话">
            {entries.map((entry) => (
              <li key={entry.sessionId} className="trash-row">
                <div className="trash-row-text">
                  <span className="trash-row-title">{entry.title}</span>
                  <span className="trash-row-meta">
                    {entry.messageCount} 条消息 · 删除于{' '}
                    {formatRelativeTime(entry.deletedAt)} · 剩{' '}
                    {trashDaysLeft(entry.deletedAt, now, TRASH_TTL_MS)} 天
                  </span>
                </div>
                <button
                  type="button"
                  className="trash-restore-btn"
                  onClick={() => onRestore(entry.sessionId)}
                  aria-label={`恢复对话：${entry.title}`}
                  title={`恢复对话：${entry.title}`}
                >
                  恢复
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="trash-note">回收站保留 7 天，之后自动清除</p>
        <button
          type="button"
          className="trash-clear-btn"
          disabled={entries.length === 0}
          onClick={() => setConfirmingClear(true)}
          aria-label="清空回收站"
          title="清空回收站"
        >
          清空回收站
        </button>
      </div>
      {confirmingClear && (
        <ConfirmDialog
          title="清空回收站"
          description={`确定永久删除回收站里的 ${entries.length} 段对话？此操作无法恢复。`}
          confirmLabel="清空回收站"
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            onClearAll();
          }}
        />
      )}
    </div>
  );
}
