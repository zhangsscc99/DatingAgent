/**
 * P06 — terminal-style input history for the composer; P168 scoped it per
 * session. Each conversation's last few sent messages persist under its own
 * `datingagent.input-history.v1:<id>` key so ArrowUp in one chat can never
 * recall private text sent in another, and deleting/clearing the session
 * takes its history with it. A chat with no session id yet shares the
 * `default` bucket, matching the chatDrafts convention.
 *
 * Order: OLDEST first, NEWEST last — recall walks the list backwards.
 *
 * Every storage access is guarded: private mode / quota failures degrade to
 * a per-session module-level in-memory list so recall keeps working for the
 * page session and nothing ever throws.
 */

import { DEFAULT_DRAFT_ID } from './chatDrafts';

/** Pre-P168 global key — never written any more, only swept by clear-all. */
export const LEGACY_INPUT_HISTORY_KEY = 'datingagent.input-history.v1';

/** Every per-session history key shares this prefix. */
const HISTORY_KEY_PREFIX = `${LEGACY_INPUT_HISTORY_KEY}:`;

/** At most this many entries are kept per session. */
const MAX_ENTRIES = 5;
/** Serialized payload cap (~10 KB); oldest entries are dropped to stay under. */
const MAX_SERIALIZED_CHARS = 10 * 1024;

/** In-memory fallback per session id for when localStorage itself throws. */
const memoryHistories = new Map<string, string[]>();

function normalizeSessionId(sessionId: string | null | undefined): string {
  return typeof sessionId === 'string' && sessionId ? sessionId : DEFAULT_DRAFT_ID;
}

/** Storage key for one session's history ('default' when no session yet). */
export function historyKey(sessionId: string | null | undefined): string {
  return `${HISTORY_KEY_PREFIX}${normalizeSessionId(sessionId)}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((e) => typeof e === 'string');
}

function withinCaps(entries: string[]): string[] {
  let next = entries.slice(-MAX_ENTRIES);
  while (next.length > 0 && JSON.stringify(next).length > MAX_SERIALIZED_CHARS) {
    next = next.slice(1);
  }
  return next;
}

function persist(sessionId: string, entries: string[]): void {
  memoryHistories.set(sessionId, entries);
  try {
    localStorage.setItem(historyKey(sessionId), JSON.stringify(entries));
  } catch {
    // Storage unavailable — the in-memory copy keeps recall working.
  }
}

/** Read one session's stored history, oldest first / newest last. Never throws. */
export function loadInputHistory(sessionId?: string | null): string[] {
  const id = normalizeSessionId(sessionId);
  let raw: string | null;
  try {
    raw = localStorage.getItem(historyKey(id));
  } catch {
    return memoryHistories.get(id) ?? [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStringArray(parsed)) return [];
    return withinCaps(parsed.map((e) => e.trim()).filter(Boolean));
  } catch {
    return [];
  }
}

/**
 * Append a sent message to one session's history (outer whitespace is
 * trimmed). Empty input is ignored and an entry equal to the most recent
 * one is dropped — no consecutive duplicates. Returns the resulting list.
 * Never throws.
 */
export function pushInputHistory(
  sessionId: string | null | undefined,
  text: string,
): string[] {
  const id = normalizeSessionId(sessionId);
  const entry = text.trim();
  const history = loadInputHistory(id);
  if (!entry || history[history.length - 1] === entry) return history;
  const next = withinCaps([...history, entry]);
  persist(id, next);
  return next;
}

/** Remove one session's history. Never throws. */
export function purgeInputHistory(sessionId: string | null | undefined): void {
  const id = normalizeSessionId(sessionId);
  memoryHistories.delete(id);
  try {
    localStorage.removeItem(historyKey(id));
  } catch {
    // Storage unavailable — history purges are best-effort.
  }
}

/** Remove the histories of several sessions. Never throws. */
export function purgeInputHistories(sessionIds: readonly string[]): void {
  for (const id of sessionIds) purgeInputHistory(id);
}

/**
 * Every localStorage key under the input-history prefix — the per-session
 * keys plus the legacy global key, which starts with the same string.
 * [] when storage cannot be enumerated (falls back to own-key enumeration).
 */
export function listInputHistoryKeys(): string[] {
  try {
    const length = localStorage.length;
    if (typeof length === 'number' && Number.isFinite(length)) {
      const keys: string[] = [];
      for (let i = 0; i < length; i += 1) {
        const key = localStorage.key(i);
        if (typeof key === 'string' && key.startsWith(LEGACY_INPUT_HISTORY_KEY)) {
          keys.push(key);
        }
      }
      return keys;
    }
  } catch {
    // Fall through to own-key enumeration.
  }
  try {
    return Object.keys(localStorage).filter((k) =>
      k.startsWith(LEGACY_INPUT_HISTORY_KEY),
    );
  } catch {
    return [];
  }
}

/**
 * Drop every input-history key — all per-session keys, the `default` bucket
 * and the pre-P168 global key — plus the in-memory fallbacks. Used by
 * "clear all" so no ArrowUp-recallable text survives the wipe. Never throws.
 */
export function purgeAllInputHistories(): void {
  memoryHistories.clear();
  for (const key of listInputHistoryKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable — leave the key in place.
    }
  }
}
