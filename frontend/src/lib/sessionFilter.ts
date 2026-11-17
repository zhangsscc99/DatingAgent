import type { StoredChatSession } from './chatStorage';

export interface SessionMessageMatch {
  role: 'user' | 'assistant';
  excerpt: string;
}

const EXCERPT_MAX = 40;

/** P238: reduce markdown markers to plain text so a body excerpt never
 * leaks `**`, `*`, `__`, `_`, backticks or line-leading `- `/`#`/`>` into
 * the sidebar. Each marker becomes a single space so words are not glued
 * together; run before whitespace collapsing and the ~40-char cut. */
function stripMarkdownMarkers(raw: string): string {
  return raw
    .replace(/\*\*|__|\*|_|`/g, ' ')
    .replace(/^[ \t]*[-*+]\s+/gm, ' ')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, ' ')
    .replace(/^[ \t]*>[ \t]?/gm, ' ');
}

/** P230: first body hit inside a session's stored messages (user or
 * assistant), or null when no message contains the trimmed, case-folded
 * query. The excerpt is the whitespace-collapsed message text clipped to a
 * <= EXCERPT_MAX char window that contains the hit, with a leading/trailing
 * … wherever text was cut. Pure: never mutates the session. */
export function matchSessionMessage(
  session: StoredChatSession,
  query: string,
): SessionMessageMatch | null {
  const q = query.trim().toLowerCase();
  if (!q || !Array.isArray(session.messages)) return null;
  for (const m of session.messages) {
    if (typeof m.content !== 'string') continue;
    const text = stripMarkdownMarkers(m.content)
      .replace(/\s+/g, ' ')
      .trim();
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    if (text.length <= EXCERPT_MAX) return { role: m.role, excerpt: text };
    let start = Math.max(
      0,
      Math.min(
        idx - Math.max(0, Math.floor((EXCERPT_MAX - q.length) / 2)),
        text.length - EXCERPT_MAX,
      ),
    );
    const end = Math.min(text.length, start + EXCERPT_MAX);
    start = Math.max(0, end - EXCERPT_MAX);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return {
      role: m.role,
      excerpt:
        prefix +
        text.slice(start + (prefix ? 1 : 0), end - (suffix ? 1 : 0)) +
        suffix,
    };
  }
  return null;
}

/** P150 matcher, extracted for reuse by the P164 state reconciler: trim +
 * case-insensitive title substring, empty query returns the original array
 * (order and identity preserved), never mutates the input.
 * P230: a session also survives when the query hits only its message body —
 * matchSessionMessage then supplies the excerpt the row shows under the
 * title. */
export function filterRecentSessions(
  sessions: StoredChatSession[],
  query: string,
): StoredChatSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) || matchSessionMessage(s, q) !== null,
  );
}
