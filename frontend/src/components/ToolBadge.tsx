import type { ToolEvent } from '../types';
import './ToolBadge.css';

interface Props {
  event: ToolEvent;
}

export default function ToolBadge({ event }: Props) {
  return (
    <div className={`tool-badge ${event.status}`}>
      <span className="tool-icon">{event.status === 'running' ? '⚙️' : '✅'}</span>
      <span>{event.label}</span>
      {event.status === 'running' && <span className="spinner" />}
    </div>
  );
}
