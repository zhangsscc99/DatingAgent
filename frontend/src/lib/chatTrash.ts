import type { ChatMessage } from '../types';
import type { ChatStorageState, StoredChatSession } from './chatStorage';

/**
 * P265 — the recycle bin for deleted conversations. A single delete or a
 * 清空全部 used to erase the localStorage copy permanently: the bubbles, the
 * drafts' context and every message were gone the moment the confirm dialog
 * closed. Deletions now move the whole session here first; entries survive
 * reloads and are restorable for TRASH_TTL_MS, after which load/prune drops
 * them automatically. The trash lives under its own key so the
 * datingAgent.chatHistory schema and the P156/P250 write paths are
 * untouched — and every localStorage access below is wrapped so a quota or
 * private-mode failure degrades to an empty trash instead of throwing.
 */

export interface TrashEntry {
  sessionId: string;
  title: string;
  messages: ChatMessage[];
  deletedAt: number;
  messageCount: number;
  /** Preserved so a restored session keeps its user-renamed title. */
  customTitle?: boolean;
}

export const TRASH_KEY = 'datingAgent.trash';
export const TRASH_TTL_MS = 7 * 24 * 3600 * 1000;
export const TRASH_MAX_SESSIONS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTrashEntries(raw: unknown): TrashEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: TrashEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { sessionId } = item;
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue;
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const messages = Array.isArray(item.messages)
      ? (item.messages.filter(isRecord) as unknown as ChatMessage[])
      : [];
    entries.push({
      sessionId,
      title:
        typeof item.title === 'string' && item.title.trim().length > 0
          ? item.title
          : '未命名对话',
      messages,
      deletedAt:
        typeof item.deletedAt === 'number' && Number.isFinite(item.deletedAt)
          ? item.deletedAt
          : 0,
      messageCount: messages.length,
      ...(item.customTitle === true ? { customTitle: true } : {}),
    });
  }
  return entries;
}

/**
 * Drop expired or undated entries and cap the list at TRASH_MAX_SESSIONS,
 * evicting the oldest deletions first. Pure: returns a new array sorted
 * newest-first, never mutates the input.
 */
export function pruneTrash(
  state: TrashEntry[],
  now: number = Date.now(),
): TrashEntry[] {
  const cutoff = now - TRASH_TTL_MS;
  return state
    .filter(
      (e) =>
        Number.isFinite(e.deletedAt) &&
        e.deletedAt > cutoff &&
        e.deletedAt <= now + 86_400_000,
    )
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, TRASH_MAX_SESSIONS);
}

/** Read the trash, normalized and pruned of expired entries. Never throws. */
export function loadTrash(now: number = Date.now()): TrashEntry[] {
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    if (!raw) return [];
    return pruneTrash(normalizeTrashEntries(JSON.parse(raw)), now);
  } catch {
    return [];
  }
}

/** Write the trash verbatim. A storage failure is swallowed — the trash is
 * best-effort by design and must never take the caller down with it. */
export function saveTrash(entries: TrashEntry[]): void {
  try {
    localStorage.setItem(TRASH_KEY, JSON.stringify(entries));
  } catch {
    // Quota/private-mode failure — nothing else to do.
  }
}

/**
 * Move whole sessions into the trash. Fresh entries are deduped against the
 * existing list by sessionId (a re-delete of the same id replaces the older
 * entry), then TTL + cap eviction runs so the bin never grows unbounded.
 * Pure: returns the new list; the caller persists it with saveTrash.
 */
export function pushTrash(
  state: TrashEntry[],
  sessions: StoredChatSession[],
  now: number = Date.now(),
): TrashEntry[] {
  const fresh: TrashEntry[] = [];
  for (const s of sessions) {
    if (!isRecord(s) || typeof s.id !== 'string' || s.id.length === 0) continue;
    const messages = Array.isArray(s.messages) ? s.messages : [];
    fresh.push({
      sessionId: s.id,
      title: typeof s.title === 'string' ? s.title : '未命名对话',
      messages,
      deletedAt: now,
      messageCount: messages.length,
      ...(s.customTitle === true ? { customTitle: true } : {}),
    });
  }
  if (fresh.length === 0) return pruneTrash(state, now);
  const freshIds = new Set(fresh.map((e) => e.sessionId));
  return pruneTrash(
    [...fresh, ...state.filter((e) => !freshIds.has(e.sessionId))],
    now,
  );
}

/**
 * P273 — drop the given session ids from a trash list. Pure: returns a new
 * array, never mutates the input; the caller persists it with saveTrash.
 * The 清空全部 undo uses it to retract exactly the entries that same clear
 * pushed into the bin.
 */
export function removeTrashEntries(
  state: TrashEntry[],
  sessionIds: string[],
): TrashEntry[] {
  const doomed = new Set(sessionIds);
  return state.filter((e) => !doomed.has(e.sessionId));
}

/**
 * Move one trash entry back into the chat-history state. The entry leaves
 * the trash (persisted via saveTrash); the restored session lands at the top
 * of the list with a fresh updatedAt. P273: an id collision with a live
 * session — e.g. the 清空全部 undo wrote the snapshot back while its trash
 * entries were still in the bin — overwrites that entry with the trash
 * copy instead of appending a second, identically-titled row. Returns null
 * when the entry is missing or already pruned.
 */
export function restoreTrash(
  state: ChatStorageState,
  sessionId: string,
  now: number = Date.now(),
): { state: ChatStorageState; session: StoredChatSession } | null {
  const entries = loadTrash(now);
  const entry = entries.find((e) => e.sessionId === sessionId);
  if (!entry) return null;
  saveTrash(pruneTrash(entries.filter((e) => e.sessionId !== sessionId), now));

  const session: StoredChatSession = {
    id: entry.sessionId,
    title: entry.title,
    updatedAt: now,
    messages: entry.messages,
    ...(entry.customTitle === true ? { customTitle: true } : {}),
  };
  const sessions = state.sessions.some((s) => s.id === session.id)
    ? state.sessions.map((s) => (s.id === session.id ? session : s))
    : [session, ...state.sessions];
  return { state: { ...state, sessions }, session };
}

/** Empty the trash entirely. Never throws. */
export function clearTrash(): void {
  try {
    localStorage.removeItem(TRASH_KEY);
  } catch {
    // Storage unavailable — nothing to remove anyway.
  }
}
