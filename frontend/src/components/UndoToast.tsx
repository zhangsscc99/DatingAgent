import './UndoToast.css';

interface Props {
  /** The status line, e.g. 已清空全部对话. */
  text: string;
  /** The undo action's label — 撤销. */
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * P247 — transient confirmation toast after 清空全部. Neutral surface
 * rather than danger styling: the action already succeeded, so this line
 * confirms it did — and offers the only way back while the clearAllUndo
 * window (owned outside this component) stays armed.
 */
export default function UndoToast({
  text,
  actionLabel,
  onAction,
  onDismiss,
}: Props) {
  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-text">{text}</span>
      <div className="undo-toast-actions">
        <button
          type="button"
          className="undo-toast-action"
          onClick={onAction}
          aria-label={actionLabel}
        >
          {actionLabel}
        </button>
        <button
          type="button"
          className="undo-toast-close"
          onClick={onDismiss}
          aria-label="关闭"
          title="关闭"
        >
          ×
        </button>
      </div>
    </div>
  );
}
