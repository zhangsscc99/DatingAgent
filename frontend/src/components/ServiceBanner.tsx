import './ServiceBanner.css';

interface Props {
  /** P11: shown only while an outage-class failure is unreconciled. */
  visible: boolean;
  /** Re-issues the last failed prompt via the existing retry path. */
  onRetry: () => void;
  onDismiss: () => void;
  /** True while a reply is in flight — the retry button stays disabled. */
  retrying?: boolean;
}

/** P11 — slim outage banner pinned to the top of the chat column. */
export default function ServiceBanner({ visible, onRetry, onDismiss, retrying = false }: Props) {
  if (!visible) return null;

  return (
    <div className="service-banner" role="status">
      <span className="service-banner-text">服务暂时不可用</span>
      <div className="service-banner-actions">
        <button
          type="button"
          className="service-banner-retry"
          onClick={onRetry}
          disabled={retrying}
          aria-label={retrying ? '正在重试' : '重试'}
        >
          {retrying ? '重试中…' : '重试'}
        </button>
        <button
          type="button"
          className="service-banner-close"
          onClick={onDismiss}
          aria-label="关闭提示"
          title="关闭提示"
        >
          ×
        </button>
      </div>
    </div>
  );
}
