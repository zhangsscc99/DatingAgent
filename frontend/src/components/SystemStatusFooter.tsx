import { useHealthPoll } from '../hooks/useHealthPoll';
import { footerLevel, statusDetail, statusLabel } from '../lib/healthStatus';
import './SystemStatusFooter.css';

/**
 * P27 — tiny footer dot mirroring /api/health: green ok, amber degraded/down.
 * P291 — the footer is a polite live region (`role="status"`) so the plain
 * language label is announced; raw level/status live only in title/aria-label.
 */
export default function SystemStatusFooter() {
  const snapshot = useHealthPoll();
  const detail = statusDetail(snapshot);

  return (
    <footer
      className={`system-status level-${footerLevel(snapshot)}`}
      role="status"
      title={detail}
      aria-label={detail}
    >
      <span className="system-status-dot" aria-hidden="true" />
      <span className="system-status-label">{statusLabel(snapshot)}</span>
    </footer>
  );
}
