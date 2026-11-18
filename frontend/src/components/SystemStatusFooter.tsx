import { useHealthPoll } from '../hooks/useHealthPoll';
import { footerLevel, statusDetail, statusLabel } from '../lib/healthStatus';
import './SystemStatusFooter.css';

/**
 * P27 — tiny footer mirroring /api/health: amber degraded/down.
 * P291 — the footer is a polite live region (`role="status"`) so the plain
 * language label is announced; raw level/status live only in title/aria-label.
 * P297 — nothing renders while all is well: a permanently-visible status chip
 * tells the user nothing. Only a warn-level snapshot mounts the footer, so
 * `role="status"` exists solely when there is something to say.
 */
export default function SystemStatusFooter() {
  const snapshot = useHealthPoll();
  const level = footerLevel(snapshot);
  if (level !== 'warn') return null;
  const detail = statusDetail(snapshot);

  return (
    <footer
      className={`system-status level-${level}`}
      role="status"
      title={detail}
      aria-label={detail}
    >
      <span className="system-status-dot" aria-hidden="true" />
      <span className="system-status-label">{statusLabel(snapshot)}</span>
    </footer>
  );
}
