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
import { DEFAULT_DRAFT_ID } from './chatDrafts';

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

/**
 * P423 — every parked draft belongs to the session it was typed in. A
 * conversation switch retires the queue: each session's prompts are
 * written back to that session's composer draft in submit order, joined
 * with '\n' in a single `save` call so a later item never clobbers an
 * earlier one. `null` sessionId — parked in a chat with no session yet —
 * targets the same `default` draft the composer uses for that chat.
 *
 * Items with an empty prompt are consumed without a write (there is no
 * text to lose). When `save` throws for one session, that session's items
 * come back in the returned remainder so the caller can keep them queued
 * rather than silently losing the text; the other sessions are still
 * retired. The return value is normally an empty array.
 */
export function retireQueue<T extends { sessionId: string | null; prompt: string }>(
  items: readonly T[],
  save: (sessionId: string, text: string) => void,
): T[] {
  const order: string[] = [];
  const promptsBySession = new Map<string, string[]>();
  const itemsBySession = new Map<string, T[]>();
  for (const item of items) {
    const key = item.sessionId ?? DEFAULT_DRAFT_ID;
    let prompts = promptsBySession.get(key);
    let owners = itemsBySession.get(key);
    if (prompts === undefined || owners === undefined) {
      prompts = [];
      owners = [];
      promptsBySession.set(key, prompts);
      itemsBySession.set(key, owners);
      order.push(key);
    }
    if (item.prompt) prompts.push(item.prompt);
    owners.push(item);
  }
  const remainder: T[] = [];
  for (const key of order) {
    const prompts = promptsBySession.get(key) ?? [];
    if (prompts.length === 0) continue;
    try {
      save(key, prompts.join('\n'));
    } catch {
      remainder.push(...(itemsBySession.get(key) ?? []));
    }
  }
  return remainder;
}

/**
 * P423 — the drain effect's cross-conversation guard. A parked draft is
 * "foreign" when the session it was queued under is not the session the
 * composer is looking at now; `null` (a chat with no session yet) is a
 * real identity, so parked-in-fresh-chat → drained-under-named-session
 * counts as foreign exactly like A→B.
 */
export function isForeignQueuedSend(
  itemSessionId: string | null,
  activeSessionId: string | null,
): boolean {
  return itemSessionId !== activeSessionId;
}
