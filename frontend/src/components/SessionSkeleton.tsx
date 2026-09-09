import './SessionSkeleton.css';

export default function SessionSkeleton() {
  return (
    <div className="session-skeleton" role="status" aria-live="polite" aria-label="正在恢复对话">
      <div className="skeleton-row assistant">
        <div className="skeleton-avatar shimmer" />
        <div className="skeleton-bubble shimmer" />
      </div>
      <div className="skeleton-row user">
        <div className="skeleton-avatar shimmer" />
        <div className="skeleton-bubble short shimmer" />
      </div>
      <div className="skeleton-row assistant">
        <div className="skeleton-avatar shimmer" />
        <div className="skeleton-bubble long shimmer" />
      </div>
      <span className="sr-only">正在恢复对话…</span>
    </div>
  );
}
