import type { StoredChatSession } from './chatStorage';
import { filterRecentSessions } from './sessionFilter';

/**
 * P369 — the sidebar 最近对话 filter as one pure, testable unit. The match
 * rule itself stays in sessionFilter.ts (P150/P230: trimmed, case-folded,
 * title OR message-body hit); this module is the single seam the sidebar
 * render and the machine assertions share, so the filter's contract —
 * which sessions survive, and when the 没有匹配 empty state may appear —
 * is named here exactly once.
 */

/** Sessions whose title or message content matches the query. Trimming and
 * case-folding live inside filterRecentSessions; a blank query returns the
 * input list untouched (order and identity preserved, never mutated). */
export function filterRecentChats(
  chats: StoredChatSession[],
  query: string,
): StoredChatSession[] {
  return filterRecentSessions(chats, query);
}

/** The 没有匹配 empty state's one render gate: true only while a typed
 * (non-blank) query matched zero chats. An empty filter box — or any
 * surviving match — keeps the hint out of the DOM. */
export function recentChatEmptyState(query: string, count: number): boolean {
  return query.trim().length > 0 && count === 0;
}
