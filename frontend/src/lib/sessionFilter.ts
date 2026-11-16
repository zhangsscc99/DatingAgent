import type { StoredChatSession } from './chatStorage';

/** P150 matcher, extracted for reuse by the P164 state reconciler: trim +
 * case-insensitive title substring, empty query returns the original array
 * (order and identity preserved), never mutates the input. */
export function filterRecentSessions(
  sessions: StoredChatSession[],
  query: string,
): StoredChatSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q));
}
