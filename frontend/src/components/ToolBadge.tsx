import type { ToolEvent } from '../types';
import './ToolBadge.css';

const TOOL_ICONS: Record<string, string> = {
  analyze_profile: '📝',
  coach_conversation: '💬',
  plan_date: '📅',
  check_compatibility: '💕',
  get_relationship_advice: '💡',
};

interface Props {
  event: ToolEvent;
}

export default function ToolBadge({ event }: Props) {
  const icon = TOOL_ICONS[event.name] ?? '🔧';
  const isRunning = event.status === 'running';

  return (
    <div
      className={`tool-badge ${event.status}`}
      title={isRunning ? `${event.label} — 执行中` : `${event.label} — 完成`}
    >
      <span className="tool-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tool-label">{event.label}</span>
      <span className="tool-status" aria-label={isRunning ? '执行中' : '完成'}>
        {isRunning ? (
          <span className="spinner" />
        ) : (
          <span className="check">✓</span>
        )}
      </span>
    </div>
  );
}
