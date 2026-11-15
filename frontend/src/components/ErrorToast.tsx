import './ErrorToast.css';

interface Props {
  /** P17: current toast text; null renders nothing. */
  text: string | null;
  /** Re-issues the newest failed prompt via the shared retry path. */
  onRetry: () => void;
  onDismiss: () => void;
  /** True while a reply is in flight — the retry button stays disabled. */
  retrying?: boolean;
}

/** P17 — self-dismissing error toast floating over the top of the chat area. */
export default function ErrorToast({ text, onRetry, onDismiss, retrying = false }: Props) {
  if (!text) return null;

  return (
    <div className="error-toast" role="alert">
      <span className="error-toast-text">{text}</span>
      <div className="error-toast-actions">
        <button
          type="button"
          className="error-toast-retry"
          onClick={onRetry}
          disabled={retrying}
          aria-label={retrying ? '正在重试' : '重试'}
        >
          {retrying ? '重试中…' : '重试'}
        </button>
        <button
          type="button"
          className="error-toast-close"
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
