/**
 * P284 — 「换一个」 dedupe helpers shared by the route validator and the
 * harness retry check. The regenerate path sends the last reply versions it
 * already showed so the model is told not to repeat them; when it still
 * echoes one back the harness retries the turn exactly once.
 */

/** At most this many previous versions travel with a regenerate request. */
export const MAX_PREVIOUS_REPLIES = 3;

/** Per-version cap so a long reply cannot blow up the system prompt. */
export const MAX_PREVIOUS_REPLY_CHARS = 4000;

/** Whitespace-insensitive comparison — a re-wrapped repeat is still a repeat. */
export function normalizeReplyText(text: string): string {
  return text.replace(/\s+/g, '');
}

export function sameReply(a: string, b: string): boolean {
  return normalizeReplyText(a) === normalizeReplyText(b);
}

/** Short enough that a verbatim embed is coincidence, not parroting. */
const MIN_EMBEDDED_REPLY_CHARS = 10;

/**
 * True when `text` repeats a shown version: identical up to whitespace, or
 * it embeds one verbatim — the failure mode where the model answers a regen
 * by parroting the「版本1：…版本2：…」list back instead of writing a reply.
 */
export function matchesAnyReply(text: string, previous: readonly string[]): boolean {
  const normalized = normalizeReplyText(text);
  return previous.some((p) => {
    const key = normalizeReplyText(p);
    if (!key) return false;
    return key === normalized || (key.length >= MIN_EMBEDDED_REPLY_CHARS && normalized.includes(key));
  });
}

/**
 * Validate the optional `previousReplies` request field into at most
 * MAX_PREVIOUS_REPLIES non-empty strings. Returns undefined when the field
 * is absent or carries no usable text, null when its shape is wrong (not an
 * array of strings) so the route can reject it with a 400.
 */
export function parsePreviousReplies(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null;
  const cleaned = value
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, MAX_PREVIOUS_REPLIES)
    .map((v) => v.slice(0, MAX_PREVIOUS_REPLY_CHARS));
  return cleaned.length > 0 ? cleaned : undefined;
}
