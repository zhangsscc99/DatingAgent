/**
 * P06 — terminal-style input history for the composer. The last few sent
 * messages persist under one localStorage key so ArrowUp can recall them
 * across reloads.
 *
 * Order: OLDEST first, NEWEST last — recall walks the list backwards.
 *
 * Every storage access is guarded: private mode / quota failures degrade to
 * a module-level in-memory list so recall keeps working for the page session
 * and nothing ever throws.
 */

export const INPUT_HISTORY_KEY = 'datingagent.input-history.v1';

/** At most this many entries are kept. */
const MAX_ENTRIES = 5;
/** Serialized payload cap (~10 KB); oldest entries are dropped to stay under. */
const MAX_SERIALIZED_CHARS = 10 * 1024;

/** In-memory fallback for when localStorage itself throws (private mode). */
let memoryHistory: string[] = [];

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

function persist(entries: string[]): void {
  memoryHistory = entries;
  try {
    localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable — the in-memory copy keeps recall working.
  }
}

/** Read the stored history, oldest first / newest last. Never throws. */
export function loadInputHistory(): string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(INPUT_HISTORY_KEY);
  } catch {
    return memoryHistory;
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
 * Append a sent message (outer whitespace is trimmed). Empty input is
 * ignored and an entry equal to the most recent one is dropped — no
 * consecutive duplicates. Returns the resulting list. Never throws.
 */
export function pushInputHistory(text: string): string[] {
  const entry = text.trim();
  const history = loadInputHistory();
  if (!entry || history[history.length - 1] === entry) return history;
  const next = withinCaps([...history, entry]);
  persist(next);
  return next;
}
