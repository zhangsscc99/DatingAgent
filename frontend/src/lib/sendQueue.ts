/**
 * P244 — while a reply is streaming the composer used to swallow Enter:
 * the draft just sat there with no queue and no explanation of whether it
 * would ever be sent. Submissions during a stream now join an in-app FIFO
 * (App owns it) that drains automatically when the turn ends, and the
 * composer copy says so.
 *
 * The queue is memory-only on purpose: a hard refresh drops it entirely
 * rather than resurrecting a half-sent state.
 */

/** Persistent composer hint while a reply streams (queue may be empty). */
export const STREAMING_QUEUE_HINT = '回复生成中，完成后将自动发送';

/**
 * The line under the composer while streaming: the auto-send promise plus,
 * once anything is queued, how many drafts are still waiting.
 */
export function queueHintText(queuedCount: number): string {
  return queuedCount > 0
    ? `${STREAMING_QUEUE_HINT} · 还有 ${queuedCount} 条待发`
    : STREAMING_QUEUE_HINT;
}

/**
 * 「取消排队」 hands the dropped drafts back to the composer: the queued
 * texts rejoin the box ahead of whatever was typed after them, oldest
 * first, so nothing the user wrote is lost.
 */
export function restoreQueuedDraft(queued: string[], current: string): string {
  const joined = queued.join('\n');
  if (!joined) return current;
  return current ? `${joined}\n${current}` : joined;
}
