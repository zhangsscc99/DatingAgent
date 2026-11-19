import type { StreamPhase } from '../types';
import './StreamingIndicator.css';

const PHASE_LABELS: Record<StreamPhase, string> = {
  thinking: '正在思考',
  tool: '正在调用工具',
  generating: '正在生成回复',
};

interface Props {
  phase: StreamPhase;
  /** P192: live waiting label; falls back to the phase label when absent. */
  label?: string;
}

export default function StreamingIndicator({ phase, label }: Props) {
  return (
    <div
      className="streaming-indicator"
      role="status"
      aria-live="polite"
      aria-label="正在输入"
    >
      {/* P356: the pending bubble is itself the polite typing announcement —
          the visible phase/ticker copy stays aria-hidden so the per-second
          waiting label can never spam the live region (App's own sr-only
          region carries the phase announcements). */}
      <span className="sr-only">正在输入…</span>
      <span className="streaming-label" aria-hidden="true">
        {label ?? PHASE_LABELS[phase]}
      </span>
      <span className="streaming-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
