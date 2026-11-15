import { useHealthPoll } from '../hooks/useHealthPoll';
import { footerLevel, statusLabel } from '../lib/healthStatus';
import './SystemStatusFooter.css';

/** P27 — tiny footer dot mirroring /api/health: green ok, amber degraded/down. */
export default function SystemStatusFooter() {
  const snapshot = useHealthPoll();
  const title = snapshot.lastCheckedAt
    ? `上次检测 ${new Date(snapshot.lastCheckedAt).toLocaleTimeString('zh-CN')}`
    : '尚未检测';

  return (
    <footer className={`system-status level-${footerLevel(snapshot)}`} title={title}>
      <span className="system-status-dot" aria-hidden="true" />
      <span className="system-status-label" aria-live="polite">
        {statusLabel(snapshot)}
      </span>
    </footer>
  );
}
