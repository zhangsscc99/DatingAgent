import type { StreamPhase } from '../types';
import './StreamingIndicator.css';

const PHASE_LABELS: Record<StreamPhase, string> = {
  thinking: '正在思考',
  tool: '正在调用工具',
  generating: '正在生成回复',
};

interface Props {
  phase: StreamPhase;
}

export default function StreamingIndicator({ phase }: Props) {
  return (
    <div className="streaming-indicator" role="status" aria-live="polite">
      <span className="streaming-label">{PHASE_LABELS[phase]}</span>
      <span className="streaming-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
