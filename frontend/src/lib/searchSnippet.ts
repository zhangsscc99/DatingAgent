/** P354 — sidebar search results used to show the full title/excerpt under
 * CSS ellipsis, so a hit sitting in the truncated tail was invisible even
 * though the row matched. This helper cuts the visible window around the
 * FIRST case-insensitive occurrence of the query: up to CONTEXT chars on
 * each side, with a leading/trailing … wherever text was clipped. The hit
 * is therefore always inside what renders — the row wraps instead of
 * ellipsising, so the <mark> can never be swallowed.
 *
 * Pure and CJK-safe (UTF-16 units — each CJK glyph counts once). Returns
 * null for a blank query or no match so callers can fall back to the
 * untruncated text. Concatenating before + match + after yields the exact
 * visible snippet. */
export interface SearchSnippet {
  /** Up to CONTEXT chars before the hit, prefixed with … when clipped. */
  before: string;
  /** The matched substring, cased exactly as it appears in text. */
  match: string;
  /** Up to CONTEXT chars after the hit, suffixed with … when clipped. */
  after: string;
}

export const SNIPPET_CONTEXT = 12;

export function searchSnippet(
  text: string,
  query: string,
): SearchSnippet | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return null;
  const matchEnd = idx + q.length;
  const from = Math.max(0, idx - SNIPPET_CONTEXT);
  const to = Math.min(text.length, matchEnd + SNIPPET_CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, idx),
    match: text.slice(idx, matchEnd),
    after: text.slice(matchEnd, to) + (to < text.length ? '…' : ''),
  };
}
