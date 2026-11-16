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
    <div className="streaming-indicator" aria-hidden="true">
      <span className="streaming-label">{label ?? PHASE_LABELS[phase]}</span>
      <span className="streaming-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
