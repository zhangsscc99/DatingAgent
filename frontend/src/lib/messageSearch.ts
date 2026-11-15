import type { ChatMessage } from '../types';

/** P19: past this length extra characters can never widen the match set. */
const MAX_QUERY_LENGTH = 100;

/** Trim, collapse whitespace runs, lowercase, cap at 100 chars. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

/** True only when the normalized query is non-empty. */
export function isSearching(query: string): boolean {
  return normalizeQuery(query).length > 0;
}

/** Case-insensitive substring match over message.content, order preserved. */
export function matchMessages(messages: ChatMessage[], query: string): ChatMessage[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return messages.filter((m) => m.content.toLowerCase().includes(q));
}

/** Number of non-overlapping case-insensitive occurrences of query in text. */
export function countMatches(text: string, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(q, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + q.length;
  }
}

/**
 * Split text into ordered hit/miss segments for case-insensitive occurrences
 * of query. Concatenating every segment.text reproduces the original text.
 */
export function highlightSegments(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = normalizeQuery(query);
  if (!q) return [{ text, hit: false }];

  const haystack = text.toLowerCase();
  const segments: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  let idx = haystack.indexOf(q);
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), hit: false });
    segments.push({ text: text.slice(idx, idx + q.length), hit: true });
    cursor = idx + q.length;
    idx = haystack.indexOf(q, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
