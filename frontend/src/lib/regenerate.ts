import type { ChatMessage } from '../types';

/**
 * P26: the user prompt that produced the last assistant reply, so "换一个" can
 * re-issue it in place. Returns null for anything that must not regenerate:
 * older turns, non-assistant targets, unknown ids, or a reply with no user
 * message directly before it.
 */
export function regeneratePromptFor(
  messages: ChatMessage[],
  messageId: string,
): string | null {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx <= 0 || idx !== messages.length - 1) return null;
  const target = messages[idx];
  const prev = messages[idx - 1];
  if (target.role !== 'assistant' || prev.role !== 'user') return null;
  return prev.content;
}
