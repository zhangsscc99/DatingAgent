/**
 * P272 — while a long reply streams, the bubble used to offer only
 * 「停止生成」 and no signal that words were actually arriving. The pending
 * bubble now carries one quiet quantitative line: 「已生成 N 字」 once body
 * tokens exist, 「正在组织答案」 before the first one lands. It is derived
 * purely from the streaming flag + content length, so the moment the turn
 * settles (`streaming: false`) the line is gone with no cleanup needed.
 *
 * Kept DOM-free so the copy contract is testable without a renderer.
 */
export const GENERATION_PROGRESS_ORGANIZING = '正在组织答案';

export function generationProgressLabel(
  contentLength: number,
  streaming: boolean,
): string | undefined {
  if (!streaming) return undefined;
  return contentLength > 0
    ? `已生成 ${contentLength} 字`
    : GENERATION_PROGRESS_ORGANIZING;
}
