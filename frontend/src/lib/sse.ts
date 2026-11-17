/**
 * P171 — tolerant SSE `data:` line parsing. A proxy/WAF can inject a
 * non-JSON frame mid-stream (an HTML error page, a truncated half-frame,
 * an empty `data:` line); parsing that inline used to throw inside the
 * turn's try/catch and the whole reply was replaced by 请求失败, losing
 * every token already received. These helpers never throw — a malformed
 * line yields null so the read loop can skip it and keep streaming.
 */
import type { AgentEvent } from '../types';

const SSE_DATA_PREFIX = 'data: ';

const AGENT_EVENT_TYPES: readonly string[] = [
  'thinking',
  'tool_start',
  'tool_end',
  'tool_progress',
  'delta',
  'message',
  'error',
  'done',
];

/** Structural check: a real AgentEvent carries a known `type` and a `data` field. */
function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    return false;
  }
  const { type } = value as { type?: unknown };
  return typeof type === 'string' && AGENT_EVENT_TYPES.includes(type);
}

/**
 * Parse one SSE line into an AgentEvent. Returns null — never throws — for
 * anything that is not a well-formed `data: {json}` event: missing prefix,
 * blank/whitespace lines, the `[DONE]` sentinel, unparseable JSON, or JSON
 * that does not look like an agent event.
 */
export function parseSseDataLine(line: string): AgentEvent | null {
  if (!line.startsWith(SSE_DATA_PREFIX)) return null;
  const payload = line.slice(SSE_DATA_PREFIX.length).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isAgentEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Terminal events end a turn: `done` on success, `error` on failure. */
export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
