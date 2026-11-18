import type { ChatMessage } from '../types';

/**
 * P284 — duplicate-regen detection. 「换一个」 used to happily stamp a fresh
 * 「约 X 秒」 badge on a reply byte-identical to the one it replaced; these
 * helpers decide when a regenerated text is really just the same answer
 * again so the bubble can show an honest retry line instead.
 */

/** Visible line under a reply that came back identical to the previous one. */
export const DUPLICATE_REGEN_HINT = '这一版和上一版一样，';

/** Label of the inline retry affordance next to DUPLICATE_REGEN_HINT. */
export const DUPLICATE_REGEN_RETRY_LABEL = '再试一次？';

/** Whitespace-insensitive compare key — a re-wrapped repeat is still a repeat. */
export function normalizeReplyForCompare(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * True when `next` repeats `prev`: identical text, or only whitespace
 * differences (rerun line breaks / trailing spaces). Empty strings never
 * count — a blank draft must not trip the duplicate UI.
 */
export function isDuplicateReply(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  return normalizeReplyForCompare(prev) === normalizeReplyForCompare(next);
}

/**
 * The versions a 「换一个」 turn must not repeat: the text currently on
 * screen plus any parked P276 versions, deduped by normalized text and
 * capped at three (the backend accepts at most three).
 */
export function collectPreviousReplies(message: ChatMessage): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of [
    message.content,
    message.previousVersion?.content,
    message.newerVersion?.content,
  ]) {
    if (typeof text !== 'string' || !text.trim()) continue;
    const key = normalizeReplyForCompare(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 3) break;
  }
  return out;
}
