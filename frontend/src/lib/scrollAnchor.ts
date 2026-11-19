/**
 * P352 — reload scroll anchors. The .messages scrollport used to reopen a
 * persisted conversation at its tail, so the first bubble the reader saw
 * after a reload was half-cut mid-reply. Instead we remember, per session,
 * the id of the first fully visible message while the user scrolls, and
 * the restore path scrolls that bubble back to the top edge on reload
 * (or pins scrollTop 0 when nothing was recorded). New messages in the
 * live session still chase the tail through the P328 auto-scroll guard —
 * anchors only affect session load/restore.
 *
 * Keys live beside the composer drafts: `datingagent-scroll-anchor:<id>`.
 * Every storage access is guarded — private mode / quota failures degrade
 * to a silent no-op and never throw.
 */

export const SCROLL_ANCHOR_PREFIX = 'datingagent-scroll-anchor:';

export function scrollAnchorKey(sessionId: string): string {
  return `${SCROLL_ANCHOR_PREFIX}${sessionId}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(store?: StorageLike): StorageLike | null {
  if (store) return store;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The persisted first-visible message id for a session, or null. */
export function loadScrollAnchor(
  sessionId: string,
  store?: StorageLike,
): string | null {
  const s = resolveStorage(store);
  if (!s || !sessionId) return null;
  try {
    const raw = s.getItem(scrollAnchorKey(sessionId));
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveScrollAnchor(
  sessionId: string,
  messageId: string,
  store?: StorageLike,
): void {
  const s = resolveStorage(store);
  if (!s || !sessionId || !messageId) return;
  try {
    s.setItem(scrollAnchorKey(sessionId), messageId);
  } catch {
    /* storage full or blocked — the anchor is best-effort */
  }
}

export function purgeScrollAnchor(
  sessionId: string,
  store?: StorageLike,
): void {
  const s = resolveStorage(store);
  if (!s) return;
  try {
    s.removeItem(scrollAnchorKey(sessionId));
  } catch {
    /* storage unavailable */
  }
}

export function purgeScrollAnchors(
  sessionIds: readonly string[],
  store?: StorageLike,
): void {
  for (const id of sessionIds) purgeScrollAnchor(id, store);
}

/** Session id remapped (P253 defensive path): carry the anchor across so a
 *  reloaded conversation still reopens where it was left. */
export function moveScrollAnchor(
  oldId: string,
  newId: string,
  store?: StorageLike,
): void {
  if (!oldId || !newId || oldId === newId) return;
  const anchor = loadScrollAnchor(oldId, store);
  if (anchor !== null) saveScrollAnchor(newId, anchor, store);
  purgeScrollAnchor(oldId, store);
}

export interface AnchorCandidate {
  id: string;
  top: number;
  bottom: number;
}

/**
 * First row completely inside the viewport — the message a reader starts
 * at. When no row fits entirely (a bubble taller than the scrollport, or
 * a zero-size measurement) the first row whose top edge is visible wins:
 * it is still a valid "start reading here" anchor and keeps restore
 * deterministic. Returns null when nothing qualifies — callers keep the
 * previously recorded anchor rather than erasing it.
 */
export function firstFullyVisibleAnchor(
  candidates: readonly AnchorCandidate[],
  viewportTop: number,
  viewportBottom: number,
): string | null {
  let topVisible: string | null = null;
  for (const c of candidates) {
    if (c.top >= viewportTop && c.bottom <= viewportBottom) return c.id;
    if (
      topVisible === null &&
      c.top >= viewportTop &&
      c.top < viewportBottom
    ) {
      topVisible = c.id;
    }
  }
  return topVisible;
}

/** Every localStorage key under the anchor prefix, or [] when storage
 *  cannot be enumerated (same fallback pattern as listDraftKeys). */
export function listScrollAnchorKeys(): string[] {
  try {
    const length = localStorage.length;
    if (typeof length === 'number' && Number.isFinite(length)) {
      const keys: string[] = [];
      for (let i = 0; i < length; i += 1) {
        const key = localStorage.key(i);
        if (typeof key === 'string' && key.startsWith(SCROLL_ANCHOR_PREFIX)) {
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
      k.startsWith(SCROLL_ANCHOR_PREFIX),
    );
  } catch {
    return [];
  }
}

/** Drop anchor keys whose session id is gone — orphans left by sessions
 *  evicted or deleted on another tab. Returns how many were removed. */
export function sweepOrphanScrollAnchors(validIds: readonly string[]): number {
  const valid = new Set(validIds);
  let removed = 0;
  for (const key of listScrollAnchorKeys()) {
    if (valid.has(key.slice(SCROLL_ANCHOR_PREFIX.length))) continue;
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch {
      /* storage unavailable — leave the key */
    }
  }
  return removed;
}
