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

import type { StreamPhase, ToolPhaseKind } from '../types';
import { formatWaitingLabel } from './thinkingTimer';

/**
 * P210 — tool-phase copy names the tool currently running and keeps the
 * waited seconds ticking: 「正在调用「关系建议」…（已等待 12 秒）」. The
 * caller passes the already-mapped Chinese label (App.tsx's TOOL_LABELS,
 * the same map the tool badges use — this file must not grow a second
 * map). Returns undefined when no tool name is known so each surface can
 * fall back to its previous copy: the aria-live region keeps
 * 「正在调用工具…」, the bubble keeps the P192 formatWaitingLabel output.
 *
 * P231 — `summarizing` covers the post-tool window: the handler has
 * returned but the model can spend many seconds writing the reply, during
 * which the bubble still names the tool whose result is being organised.
 *
 * P248 — the tool name is quoted with Chinese 「」 and the actions are
 * verb phrases (no half-width colon, no 「…的结果」). Once a summarizing
 * wait crosses SUMMARIZING_EXIT_HINT_AFTER_MS the label gains an exit
 * hint telling the user the reply will stay put; the `calling` phase
 * keeps the P240 copy untouched.
 */
export const SUMMARIZING_EXIT_HINT = '这次有点慢，你可以先切走，回复会留在这里';
export const SUMMARIZING_EXIT_HINT_AFTER_MS = 20_000;

export function toolPhaseLabel(
  toolLabel: string | undefined,
  elapsedMs: number,
  phase: ToolPhaseKind = 'calling',
): string | undefined {
  if (!toolLabel) return undefined;
  const prefix =
    phase === 'summarizing'
      ? `正在整理「${toolLabel}」的建议…`
      : `正在调用「${toolLabel}」…`;
  let label = prefix;
  if (elapsedMs >= 1000) {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedMs < 60_000) {
      label = `${prefix}（已等待 ${totalSeconds} 秒）`;
    } else {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      label = `${prefix}（已等待 ${minutes} 分 ${seconds} 秒）`;
    }
  }
  if (phase === 'summarizing' && elapsedMs >= SUMMARIZING_EXIT_HINT_AFTER_MS) {
    label = `${label}，${SUMMARIZING_EXIT_HINT}`;
  }
  return label;
}

/**
 * P240 — while the stream still has no body token, a bare label can't say
 * what the hold-up is. Once the wait passes MODEL_WAIT_HINT_AFTER_MS the
 * wait copy gains a trailing 「在等模型开始写，最多再等一会儿」 clause. It
 * is skipped while a tool call is still running ('calling') — the named
 * tool label already explains that window — and it disappears the moment
 * the first delta/message lands, because the caller drops the whole wait
 * label as soon as content exists.
 */
export const MODEL_WAIT_HINT = '在等模型开始写，最多再等一会儿';
export const MODEL_WAIT_HINT_AFTER_MS = 8_000;

export function appendModelWaitHint(
  label: string,
  elapsedMs: number,
  toolPhase?: ToolPhaseKind,
): string {
  if (!label || elapsedMs < MODEL_WAIT_HINT_AFTER_MS || toolPhase === 'calling') {
    return label;
  }
  return `${label}，${MODEL_WAIT_HINT}`;
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
  toolPhase: ToolPhaseKind = 'calling',
): string {
  switch (phase) {
    case undefined:
      return '';
    case 'thinking':
      return '正在思考…';
    case 'tool':
      return toolPhaseLabel(currentToolLabel, waitingElapsedMs, toolPhase) ?? '正在调用工具…';
    case 'generating':
      // P231: while a tool result is being written up, keep naming it even
      // though the stream phase already flipped to generating.
      if (toolPhase === 'summarizing') {
        const label = toolPhaseLabel(currentToolLabel, waitingElapsedMs, 'summarizing');
        if (label) return label;
      }
      // Under one second formatWaitingLabel still says 「正在思考…」;
      // the phase is already generating, so keep the generating prefix.
      return waitingElapsedMs < 1000
        ? '正在生成…'
        : formatWaitingLabel(waitingElapsedMs);
  }
}
