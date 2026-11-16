import type { AgentEvent } from '../types';

/**
 * P189 — fold a content-bearing SSE event into the streaming reply draft.
 *
 * `delta` appends one upstream increment so the bubble grows while the model
 * is still writing; `message` replaces the draft with the authoritative
 * text (P171: a skipped bad frame never discards tokens already received).
 * Every other event — or a payload without a string `content` — returns
 * null so the read loop leaves the draft untouched.
 */
export function foldReplyDraft(draft: string, event: AgentEvent): string | null {
  if (event.type !== 'delta' && event.type !== 'message') return null;
  const data = event.data as { content?: unknown };
  if (typeof data?.content !== 'string') return null;
  return event.type === 'delta' ? draft + data.content : data.content;
}
