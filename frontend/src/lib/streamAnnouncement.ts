/**
 * P198 — screen-reader announcement for the streaming placeholder.
 *
 * The old inline expression prefixed `正在生成…` in front of every phase
 * label, and the `generating` label itself was `正在生成回复`, so the
 * aria-live span read 「正在生成…正在生成回复」 and never mentioned how
 * long the user had waited. The rules now mirror the visible bubble:
 * each phase is distinguishable, and `generating` reuses the P192
 * elapsed-time label so the wait duration is announced too.
 *
 * Kept DOM-free so the copy contract is testable without a renderer.
 */

import type { StreamPhase } from '../types';
import { formatWaitingLabel } from './thinkingTimer';

/**
 * Live-region text for the current stream phase. `undefined` means no
 * stream is in flight and announces nothing. The returned string must
 * never contain 「正在生成」 twice.
 */
export function streamAnnouncement(
  phase: StreamPhase | undefined,
  waitingElapsedMs: number,
): string {
  switch (phase) {
    case undefined:
      return '';
    case 'thinking':
      return '正在思考…';
    case 'tool':
      return '正在调用工具…';
    case 'generating':
      // Under one second formatWaitingLabel still says 「正在思考…」;
      // the phase is already generating, so keep the generating prefix.
      return waitingElapsedMs < 1000
        ? '正在生成…'
        : formatWaitingLabel(waitingElapsedMs);
  }
}
