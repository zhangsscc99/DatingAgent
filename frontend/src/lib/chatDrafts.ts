/**
 * P159 — per-session composer drafts live under `datingagent-draft:<id>`.
 * Deleting or clearing a session must remove its draft too: the text of a
 * wiped private conversation (or of a session evicted by the cap) must not
 * linger in localStorage where a later session re-created under the same id
 * would read it back.
 *
 * Every storage access is guarded: private mode / quota failures degrade to
 * a silent no-op or an empty list — none of these functions ever throws.
 */

/** Prefix of every draft key — must match the format InputBar always used. */
export const DRAFT_PREFIX = 'datingagent-draft:';

/** Draft id for a chat that has no session yet (see ChatWindow/InputBar). */
export const DEFAULT_DRAFT_ID = 'default';

/** Storage key for one session's draft. */
export function draftStorageKey(sessionId: string): string {
  return `${DRAFT_PREFIX}${sessionId}`;
}

/** Remove one session's draft. Never throws. */
export function purgeDraft(sessionId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(sessionId));
  } catch {
    // Storage unavailable — drafts are best-effort.
  }
}

/** Remove the drafts of several sessions. Never throws. */
export function purgeDrafts(sessionIds: readonly string[]): void {
  for (const id of sessionIds) purgeDraft(id);
}

/**
 * Every localStorage key under the draft prefix, or [] when storage cannot
 * be enumerated (private mode, or a Storage-like object without
 * length/key() — those fall back to own-key enumeration).
 */
export function listDraftKeys(): string[] {
  try {
    const length = localStorage.length;
    if (typeof length === 'number' && Number.isFinite(length)) {
      const keys: string[] = [];
      for (let i = 0; i < length; i += 1) {
        const key = localStorage.key(i);
        if (typeof key === 'string' && key.startsWith(DRAFT_PREFIX)) {
          keys.push(key);
        }
      }
      return keys;
    }
  } catch {
    // Fall through to own-key enumeration.
  }
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Drop every draft key whose session id is not in `validIds` — orphans left
 * by sessions deleted before draft purging existed. Returns how many keys
 * were removed. Never throws.
 */
export function sweepOrphanDrafts(validIds: readonly string[]): number {
  const valid = new Set(validIds);
  let removed = 0;
  for (const key of listDraftKeys()) {
    if (valid.has(key.slice(DRAFT_PREFIX.length))) continue;
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch {
      // Storage unavailable — leave the key in place.
    }
  }
  return removed;
}
