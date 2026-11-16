import type { ChatMessage } from '../types';

/**
 * P161 — an interrupted stream (refresh, killed tab, crash) leaves a
 * persisted user bubble whose assistant reply was filtered out by
 * serializeMessages, so a restored conversation can end on a bare user
 * message with no affordance to answer it.
 *
 * `needsReply` reports exactly that shape: the last row is a user message.
 * Any trailing assistant row counts as a reply — a `streaming` row is a
 * reply in flight, and an `error` row already carries the F09 retry path —
 * so the button never offers to answer a message the model already
 * answered (or is answering).
 */
export function needsReply(messages: ChatMessage[]): boolean {
  if (messages.length === 0) return false;
  return messages[messages.length - 1].role === 'user';
}

/**
 * The prompt the 「生成回复」 action re-issues: the trailing user message's
 * own text, or null when the conversation is not awaiting a reply (or the
 * message is blank — the composer trims, so a stored bubble never is).
 */
export function pendingReplyPrompt(messages: ChatMessage[]): string | null {
  if (!needsReply(messages)) return null;
  const content = messages[messages.length - 1].content;
  return content.trim() ? content : null;
}

/**
 * Single guard shared by the button and the click handler: while a request
 * is in flight the action is disabled and a rapid second click is a no-op,
 * so repeated clicks yield exactly one reply.
 */
export function canGenerateReply(messages: ChatMessage[], busy: boolean): boolean {
  return !busy && pendingReplyPrompt(messages) !== null;
}
