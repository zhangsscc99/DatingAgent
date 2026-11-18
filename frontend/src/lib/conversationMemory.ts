import type { ConversationMemory, MemoryFact } from '../types';

/**
 * P339 — the server-held memory of a conversation. Facts are mined
 * per user turn on the backend, listed via GET and forgotten via DELETE;
 * the capsule treats this as the source of truth whenever it is fetched.
 * Every call is best-effort: a network failure or a 404 (a session the
 * backend never held, e.g. one minted but not yet chatted on) yields null
 * / false so callers can fall back to the local receipt derivation.
 */

function isMemoryFact(value: unknown): value is MemoryFact {
  const f = value as MemoryFact | null;
  return (
    !!f &&
    typeof f === 'object' &&
    typeof f.key === 'string' &&
    f.key.length > 0 &&
    typeof f.text === 'string' &&
    f.text.length > 0 &&
    typeof f.ts === 'number'
  );
}

/** Fetch the remembered facts for one conversation; null when unknown. */
export async function fetchConversationMemory(
  sessionId: string,
): Promise<ConversationMemory | null> {
  try {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(sessionId)}/memory`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      count?: unknown;
      items?: unknown;
    };
    const items = Array.isArray(body.items)
      ? body.items.filter(isMemoryFact)
      : [];
    return {
      count: typeof body.count === 'number' ? body.count : items.length,
      items,
    };
  } catch {
    return null;
  }
}

/**
 * Forget one fact server-side. True only when the backend confirmed the
 * deletion — a 404 (unknown key/conversation) or a network failure keeps
 * the fact on screen rather than pretending it is gone.
 */
export async function forgetConversationMemory(
  sessionId: string,
  key: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(sessionId)}/memory/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { deleted?: unknown };
    return body.deleted === true;
  } catch {
    return false;
  }
}

/** A memory payload with one fact removed; count never dips below zero. */
export function removeMemoryFact(
  memory: ConversationMemory,
  key: string,
): ConversationMemory {
  const items = memory.items.filter((f) => f.key !== key);
  return { count: items.length, items };
}
