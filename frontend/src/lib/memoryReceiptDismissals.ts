/**
 * P308 — receipt items the user deleted from the 「记得你提到」 capsule.
 * Clicking × on a remembered row drops that fact from the client state the
 * receipt is derived over: the exact item string is recorded here and the
 * derivation filters it out, so a deleted fact never re-enters the
 * receipt. The list is global rather than per-session — deleting asks the
 * app to forget the fact, and the same conversation state may be restored
 * under a remapped session id.
 *
 * Persisted in localStorage; storage failures degrade to an in-memory
 * copy that still applies for the rest of the session. The chat itself is
 * untouched — a dismissal only narrows what the receipt names.
 */

const STORAGE_KEY = 'datingagent.memoryDismissals';
/** Bounded so a long-lived install cannot grow the key without limit. */
const MAX_DISMISSED = 100;

let memoryFallback: string[] | null = null;

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // Only reachable when storage itself is unavailable — fall back to the
    // in-memory copy written this session. A readable-but-absent key above
    // means no dismissals, so a wiped store never resurrects deleted facts.
    return memoryFallback ?? [];
  }
}

function write(items: string[]): void {
  memoryFallback = items;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable — the in-memory copy still applies this session.
  }
}

/** Item strings the user has deleted from the receipt, oldest first. */
export function dismissedReceiptItems(): string[] {
  return read();
}

/**
 * Record `item` as deleted and return the updated dismissal list. Idempotent:
 * dismissing the same item twice keeps a single entry.
 */
export function dismissReceiptItem(item: string): string[] {
  const trimmed = item.trim();
  const current = read();
  if (!trimmed) return current;
  const next = [...current.filter((i) => i !== trimmed), trimmed].slice(
    -MAX_DISMISSED,
  );
  write(next);
  return next;
}

/**
 * P330 — undo path for a deleted receipt item: remove `item` from the
 * persisted list and return the new list. Idempotent — restoring an item
 * that is not dismissed (never was, already restored, or long since
 * evicted) returns the current list untouched: no write, no reorder, no
 * duplicate. Blank input is a no-op for the same reason.
 */
export function restoreReceiptItem(item: string): string[] {
  const trimmed = item.trim();
  const current = read();
  if (!trimmed || !current.includes(trimmed)) return current;
  const next = current.filter((i) => i !== trimmed);
  write(next);
  return next;
}
