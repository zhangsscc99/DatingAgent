/**
 * P272 — while a long reply streams, the bubble used to offer only
 * 「停止生成」 and no signal that words were actually arriving. The pending
 * bubble now carries one quiet line: a progress copy once body tokens
 * exist, 「正在组织答案」 before the first one lands. It is derived
 * purely from the streaming flag + content length, so the moment the turn
 * settles (`streaming: false`) the line is gone with no cleanup needed.
 *
 * P318 — the 「已生成 N 字」 count the line used to paint read like debug
 * output pinned to the bubble's foot. The visible line now carries the
 * quiet human GENERATION_PROGRESS_WRITING copy; generationProgressLabel
 * keeps its pure contract (「正在组织答案」 feeds the pre-token
 * placeholder, and the truthy label is what gates the in-stream line),
 * but the raw count is never painted.
 *
 * Kept DOM-free so the copy contract is testable without a renderer.
 */
export const GENERATION_PROGRESS_ORGANIZING = '正在组织答案';

/**
 * P318 — the in-stream line under a pending bubble: quiet human copy,
 * never the internal character count.
 */
export const GENERATION_PROGRESS_WRITING = '正在写…';

export function generationProgressLabel(
  contentLength: number,
  streaming: boolean,
): string | undefined {
  if (!streaming) return undefined;
  return contentLength > 0
    ? `已生成 ${contentLength} 字`
    : GENERATION_PROGRESS_ORGANIZING;
}
