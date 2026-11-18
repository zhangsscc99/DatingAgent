/**
 * P244 — while a reply is streaming the composer used to swallow Enter:
 * the draft just sat there with no queue and no explanation of whether it
 * would ever be sent. Submissions during a stream now join an in-app FIFO
 * (App owns it) that drains automatically when the turn ends, and the
 * composer copy says so.
 *
 * P310 — …but only once drafts are actually parked. While the queue is
 * empty the row stays silent: the pending AI bubble already owns progress
 * copy (「正在组织答案」/「正在写…」), and a global "reply generating"
 * line rendered directly under the user's just-sent bubble read like the
 * message had never gone out.
 *
 * The queue is memory-only on purpose: a hard refresh drops it entirely
 * rather than resurrecting a half-sent state.
 */

/**
 * The line under the composer while streaming. Empty while the queue is
 * empty (P310); once drafts are parked it acknowledges them by count and
 * names when they go out — 「结束后发送」, never a global auto-send
 * promise, which read like the already-sent user message was itself
 * still waiting.
 */
export function queueHintText(queuedCount: number): string {
  return queuedCount > 0
    ? `已排队 ${queuedCount} 条，本条回复结束后发送`
    : '';
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
