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
 * P210 — tool-phase copy names the tool currently running and keeps the
 * waited seconds ticking: 「正在调用:关系建议…（已等待 12 秒）」. The caller
 * passes the already-mapped Chinese label (App.tsx's TOOL_LABELS, the same
 * map the tool badges use — this file must not grow a second map).
 * Returns undefined when no tool name is known so each surface can fall
 * back to its previous copy: the aria-live region keeps 「正在调用工具…」,
 * the bubble keeps the P192 formatWaitingLabel output.
 */
export function toolPhaseLabel(
  toolLabel: string | undefined,
  elapsedMs: number,
): string | undefined {
  if (!toolLabel) return undefined;
  const prefix = `正在调用:${toolLabel}…`;
  if (elapsedMs < 1000) return prefix;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedMs < 60_000) return `${prefix}（已等待 ${totalSeconds} 秒）`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${prefix}（已等待 ${minutes} 分 ${seconds} 秒）`;
}

/**
 * Live-region text for the current stream phase. `undefined` means no
 * stream is in flight and announces nothing. The returned string must
 * never contain 「正在生成」 twice.
 */
export function streamAnnouncement(
  phase: StreamPhase | undefined,
  waitingElapsedMs: number,
  currentToolLabel?: string,
): string {
  switch (phase) {
    case undefined:
      return '';
    case 'thinking':
      return '正在思考…';
    case 'tool':
      return toolPhaseLabel(currentToolLabel, waitingElapsedMs) ?? '正在调用工具…';
    case 'generating':
      // Under one second formatWaitingLabel still says 「正在思考…」;
      // the phase is already generating, so keep the generating prefix.
      return waitingElapsedMs < 1000
        ? '正在生成…'
        : formatWaitingLabel(waitingElapsedMs);
  }
}
