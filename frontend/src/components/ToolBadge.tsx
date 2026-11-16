import type { ToolEvent } from '../types';
import './ToolBadge.css';

// P207: restrained inline SVGs (currentColor stroke) replace the emoji glyphs;
// the text label still carries the meaning, so every icon is aria-hidden.
const TOOL_ICON_PATHS: Record<string, string[]> = {
  analyze_profile: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
  coach_conversation: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  plan_date: [
    'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
    'M16 2v4',
    'M8 2v4',
    'M3 10h18',
  ],
  check_compatibility: [
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  ],
  get_relationship_advice: [
    'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
    'M9 18h6',
    'M10 22h4',
  ],
};

const FALLBACK_ICON_PATHS = [
  'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
];

interface Props {
  event: ToolEvent;
}

export default function ToolBadge({ event }: Props) {
  const iconPaths = TOOL_ICON_PATHS[event.name] ?? FALLBACK_ICON_PATHS;
  const isRunning = event.status === 'running';

  return (
    <div
      className={`tool-badge ${event.status}`}
      title={isRunning ? `${event.label} — 执行中` : `${event.label} — 完成`}
    >
      <svg
        className="tool-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {iconPaths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span className="tool-label">{event.label}</span>
      <span className="tool-status" role="img" aria-label={isRunning ? '执行中' : '完成'}>
        {isRunning ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <span className="check" aria-hidden="true">
            ✓
          </span>
        )}
      </span>
    </div>
  );
}
