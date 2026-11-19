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
 * Mirrors regeneratePromptFor's preconditions: more than one message, the last
 * is a settled (non-error, non-streaming) assistant reply, and the message
 * right before it is the user prompt it answered.
 */
export function regenerableMessageId(messages: ChatMessage[]): string | null {
  if (messages.length <= 1) return null;
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  if (last.role !== 'assistant' || last.error || last.streaming) return null;
  if (prev.role !== 'user') return null;
  return last.id;
}
