import type { Message } from '../agent/types.js';

/** Default history ceilings: newest 40 messages, at most ~24k chars of text. */
export const HISTORY_DEFAULT_MAX_MESSAGES = 40;
export const HISTORY_DEFAULT_MAX_CHARS = 24_000;

export interface CapHistoryOptions {
  maxMessages?: number;
  maxChars?: number;
}

/** Stored history only ever holds user/assistant text turns. */
function isHistoryEntry(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const role = (value as { role?: unknown }).role;
  const content = (value as { content?: unknown }).content;
  return (role === 'user' || role === 'assistant') && typeof content === 'string';
}

/**
 * Trim a conversation history to a bounded prompt size, keeping the NEWEST
 * turns. Trims from the oldest end by message count first, then by a total
 * character budget. A user/assistant turn is never split: the kept slice
 * never begins with an orphan `assistant` whose `user` half was cut.
 * The input is never mutated; empty or malformed input returns `[]`.
 */
export function capHistory(history: unknown, options: CapHistoryOptions = {}): Message[] {
  if (!Array.isArray(history)) return [];
  const maxMessages = options.maxMessages ?? HISTORY_DEFAULT_MAX_MESSAGES;
  const maxChars = options.maxChars ?? HISTORY_DEFAULT_MAX_CHARS;

  const entries = history.filter(isHistoryEntry);
  const kept = entries.slice(Math.max(0, entries.length - maxMessages));

  let totalChars = 0;
  for (const entry of kept) totalChars += entry.content.length;

  // Drop the oldest entry while over the char budget, or while the head is
  // an orphan `assistant` whose `user` prompt was already trimmed.
  while (kept.length > 0 && (totalChars > maxChars || kept[0].role === 'assistant')) {
    totalChars -= kept.shift()!.content.length;
  }

  return kept;
}

/**
 * Budget overrides for capHistory, read from the environment at the call
 * site so the pure function stays deterministic. Non-numeric or
 * non-positive values fall back to the defaults.
 */
export function historyLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Required<CapHistoryOptions> {
  const maxMessages = Number(env.HISTORY_MAX_MESSAGES);
  const maxChars = Number(env.HISTORY_MAX_CHARS);
  return {
    maxMessages:
      Number.isFinite(maxMessages) && maxMessages > 0
        ? Math.floor(maxMessages)
        : HISTORY_DEFAULT_MAX_MESSAGES,
    maxChars:
      Number.isFinite(maxChars) && maxChars > 0
        ? Math.floor(maxChars)
        : HISTORY_DEFAULT_MAX_CHARS,
  };
}
