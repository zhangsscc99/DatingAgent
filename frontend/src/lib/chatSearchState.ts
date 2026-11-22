import type { ChatMessage } from '../types';

/**
 * P162: the search UI state ChatWindow keeps locally. It must be reset when
 * the visible session changes — App renders ChatWindow without a key, so
 * component state otherwise leaks across conversations.
 */
export interface ChatSearchState {
  open: boolean;
  query: string;
  activeIndex: number;
}

export const EMPTY_CHAT_SEARCH: ChatSearchState = {
  open: false,
  query: '',
  activeIndex: 0,
};

/** Same session → keep the state untouched; a different one → start clean. */
export function resetSearchOnSessionChange(
  state: ChatSearchState,
  prevSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): ChatSearchState {
  return prevSessionId === nextSessionId ? state : EMPTY_CHAT_SEARCH;
}

/**
 * Only the true last message may be retried (App's handleRetry drops any other
 * id). Returns its id when it is a failed or still-incomplete (P398 truncated)
 * assistant turn, else null — so an older bubble surfaced by a search filter
 * never gets a dead button.
 */
export function retryableMessageId(messages: ChatMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || (!last.error && !last.truncated)) {
    return null;
  }
  return last.id;
}

/**
 * P438: every settled assistant reply offers 换一个 — not only the newest —
 * so same-kind bubbles carry the identical action row. Mirrors
 * regeneratePromptFor's preconditions per message: a settled (non-error,
 * non-streaming) assistant reply whose predecessor is the user prompt it
 * answered.
 */
export function regenerableMessageIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || msg.error || msg.streaming) continue;
    if (messages[i - 1].role !== 'user') continue;
    ids.add(msg.id);
  }
  return ids;
}
