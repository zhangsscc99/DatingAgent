import type { ChatMessage, ReplyMeta, UserProfile } from '../types';
import { purgeDraft, purgeDrafts } from './chatDrafts';
import { loadTrash, pushTrash, restoreTrash, saveTrash } from './chatTrash';
import {
  purgeAllInputHistories,
  purgeInputHistories,
  purgeInputHistory,
} from './inputHistory';
import {
  moveScrollAnchor,
  purgeScrollAnchor,
  purgeScrollAnchors,
} from './scrollAnchor';

const STORAGE_KEY = 'datingAgent.chatHistory';
const MAX_SESSIONS = 20;

/**
 * P250 — timestamp (epoch ms) of the last 清空全部. Stored under its own key
 * so the chat-history payload schema is untouched. saveChatSession refuses
 * to persist a copy whose messages all predate this stamp: such a copy can
 * only be stale in-memory state from before the wipe (its real home was
 * already deleted), and writing it back was what resurrected cleared history
 * milliseconds after the user confirmed.
 */
const CLEARED_AT_KEY = 'datingAgent.chatClearedAt';

function readClearedAt(): number | null {
  try {
    const raw = localStorage.getItem(CLEARED_AT_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeClearedAt(timestamp: number): void {
  try {
    localStorage.setItem(CLEARED_AT_KEY, String(timestamp));
  } catch {
    // Storage unavailable — the empty-state write below still runs.
  }
}

/**
 * P250 — the exact JSON this tab last wrote to STORAGE_KEY. A `storage`
 * event carrying the same `newValue` carries nothing new: either a
 * same-window echo (non-standard, but seen in instrumented/headless
 * browsers) or a foreign write byte-identical to our own — syncing from it
 * would only feed the save → watch → setState → save loop.
 */
let lastPersistedJson: string | null = null;

export interface StoredChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  /** Set when the user renamed the session — saveChatSession must not
   * overwrite a custom title with the auto-derived one. */
  customTitle?: boolean;
}

export interface ChatStorageState {
  activeSessionId: string | null;
  sessions: StoredChatSession[];
}

function defaultState(): ChatStorageState {
  return { activeSessionId: null, sessions: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NORMALIZED_TITLE_FALLBACK = '未命名对话';

/** P243: a stored token count past this is corrupt data, not a real reply. */
const MAX_STORED_META_TOKENS = 1_000_000;

/**
 * P243 — the reply meta line (tool name + 「约 N 秒」) now rides the storage
 * round trip, so the same gate runs on write and on read: keep only a
 * well-formed `meta` (non-empty string tool, finite non-negative latencyMs,
 * finite token count within a sane bound). Any other field, a non-object
 * meta, or a meta with no surviving field is dropped silently — never
 * throws, never renders garbage after a reload.
 */
export function normalizeReplyMeta(raw: unknown): ReplyMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const meta: ReplyMeta = {};
  if (typeof raw.tool === 'string' && raw.tool.trim().length > 0) {
    meta.tool = raw.tool;
  }
  if (
    typeof raw.latencyMs === 'number' &&
    Number.isFinite(raw.latencyMs) &&
    raw.latencyMs >= 0
  ) {
    meta.latencyMs = raw.latencyMs;
  }
  if (
    typeof raw.tokens === 'number' &&
    Number.isFinite(raw.tokens) &&
    raw.tokens >= 0 &&
    raw.tokens <= MAX_STORED_META_TOKENS
  ) {
    meta.tokens = raw.tokens;
  }
  return meta.tool !== undefined ||
    meta.latencyMs !== undefined ||
    meta.tokens !== undefined
    ? meta
    : undefined;
}

/**
 * P158 — self-heal stored session entries. One corrupted record (written by
 * an older version or hand-edited) used to white-screen the app at
 * `session.messages.map`. Drops invalid sessions and individual invalid
 * messages, repairs recoverable fields, and never throws or mutates input.
 */
export function normalizeStoredSessions(raw: unknown): StoredChatSession[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sessions: StoredChatSession[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id } = entry;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const title =
      typeof entry.title === 'string' && entry.title.trim().length > 0
        ? entry.title
        : NORMALIZED_TITLE_FALLBACK;
    const messages = Array.isArray(entry.messages)
      ? entry.messages
          .filter(isRecord)
          // P169: a blank assistant bubble persisted by the pre-fix abort
          // path is dead weight — drop it on rehydrate too.
          .filter(
            (m) =>
              m.role !== 'assistant' ||
              (typeof m.content === 'string' && m.content.trim().length > 0),
          )
          // P243: a malformed persisted meta (hand-edited or written by an
          // older build) must not reach the bubble — a well-formed one is
          // kept verbatim, anything else loses the field entirely.
          .map((m): Record<string, unknown> => {
            if (!('meta' in m)) return m;
            const meta = normalizeReplyMeta(m.meta);
            const { meta: _dropped, ...rest } = m;
            return meta ? { ...rest, meta } : rest;
          })
      : [];
    const updatedAt =
      typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : 0;
    sessions.push({
      id,
      title,
      updatedAt,
      messages: messages as unknown as ChatMessage[],
      ...(entry.customTitle === true ? { customTitle: true } : {}),
    });
  }
  return sessions;
}

/**
 * P314 — explicit schema version for the STORAGE_KEY payload, stamped under
 * its own key so the payload shape is untouched. Payloads written before
 * this stamp existed are schema 1; every persistState write now stamps
 * CHAT_STORAGE_SCHEMA_VERSION. On load, a missing or older stamp migrates
 * the payload in place (normalise + rewrite + stamp) — never discards it —
 * and records the migration so a rebuild that bumps the schema leaves a
 * console line instead of silently-empty history. A stamp NEWER than this
 * build (a downgrade) is loaded as-is and left alone: unknown versions
 * never wipe existing conversations.
 */
const SCHEMA_VERSION_KEY = 'datingAgent.schemaVersion';
const LEGACY_SCHEMA_VERSION = 1;
export const CHAT_STORAGE_SCHEMA_VERSION = 2;

export interface StorageMigration {
  fromVersion: number;
  toVersion: number;
  sessionCount: number;
  at: number;
}

let lastMigration: StorageMigration | null = null;
let migrationAttempted = false;

/** The in-place schema migration this page load ran, or null when none was needed. */
export function getLastMigration(): StorageMigration | null {
  return lastMigration;
}

/** Mirrors clearLastEvictionNotice: forget the recorded migration so the
 * next load may detect and record a fresh one. */
export function clearLastMigration(): void {
  lastMigration = null;
  migrationAttempted = false;
}

function recordMigration(record: StorageMigration): void {
  lastMigration = record;
  try {
    console.info(
      `[chatStorage] migrated schema v${record.fromVersion} → v${record.toVersion} ` +
        `(${record.sessionCount} sessions preserved)`,
    );
  } catch {
    /* console unavailable — the migration still proceeds */
  }
}

function readSchemaVersion(): number | null {
  try {
    const raw = localStorage.getItem(SCHEMA_VERSION_KEY);
    if (raw === null) return null;
    const version = Number(raw);
    return Number.isInteger(version) && version > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * P314 — migrate a legacy payload to the current schema in place. The v1 →
 * v2 upgrade adds only the version stamp itself (the payload shape is
 * unchanged, and normalizeStoredSessions already self-heals the bytes on
 * every read), so the migration is the stamp: STORAGE_KEY is NOT rewritten
 * here — a read path stays read-only, and the next persistState writes the
 * clean payload anyway. A future schema change that alters the payload is
 * where the rewrite belongs. Best-effort and never throws: a failed stamp
 * leaves the legacy bytes untouched and migrationAttempted keeps a dead
 * store from retrying (and logging) once per load within this page's
 * lifetime.
 */
function migrateSchemaIfNeeded(state: ChatStorageState): void {
  if (migrationAttempted) return;
  const version = readSchemaVersion();
  if (version !== null && version >= CHAT_STORAGE_SCHEMA_VERSION) return;
  migrationAttempted = true;
  recordMigration({
    fromVersion: version ?? LEGACY_SCHEMA_VERSION,
    toVersion: CHAT_STORAGE_SCHEMA_VERSION,
    sessionCount: state.sessions.length,
    at: Date.now(),
  });
  try {
    localStorage.setItem(SCHEMA_VERSION_KEY, String(CHAT_STORAGE_SCHEMA_VERSION));
  } catch {
    /* storage unavailable — the next page load retries */
  }
}

export function loadChatState(): ChatStorageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return defaultState();
    const state: ChatStorageState = {
      activeSessionId:
        typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
      sessions: normalizeStoredSessions(parsed.sessions),
    };
    // P314: a payload written by an older build (missing or older version
    // stamp) is migrated in place — never discarded.
    migrateSchemaIfNeeded(state);
    return state;
  } catch {
    return defaultState();
  }
}

export interface PersistResult {
  ok: boolean;
  droppedSessions: number;
}

const PERSIST_WARNING_MESSAGE = '本地存储空间不足，已清理最早的对话';

let lastPersistWarning: string | null = null;

/** Warning left by the most recent persist attempt, or null after a clean write. */
export function getLastPersistWarning(): string | null {
  return lastPersistWarning;
}

/** Persist chat state without ever throwing on quota/private-mode failures.
 * On a write error, drops the oldest sessions one at a time (never the active
 * one while others remain) and retries; if a single session still fails, retries
 * once with an empty session list keeping activeSessionId. Never rethrows. */
export function persistWithQuotaFallback(
  state: ChatStorageState,
  write: (json: string) => void,
  maxSessions: number = MAX_SESSIONS,
): PersistResult {
  let dropped = Math.max(0, state.sessions.length - maxSessions);
  let working: ChatStorageState = {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.slice(0, maxSessions),
  };
  let retriedEmpty = false;

  for (;;) {
    try {
      write(JSON.stringify(working));
      lastPersistWarning = dropped > 0 ? PERSIST_WARNING_MESSAGE : null;
      return { ok: true, droppedSessions: dropped };
    } catch {
      const removable = working.sessions.filter((s) => s.id !== working.activeSessionId);
      if (removable.length > 0) {
        const oldest = removable.reduce((a, b) => (a.updatedAt <= b.updatedAt ? a : b));
        working = {
          ...working,
          sessions: working.sessions.filter((s) => s.id !== oldest.id),
        };
        dropped += 1;
      } else if (!retriedEmpty) {
        retriedEmpty = true;
        dropped += working.sessions.length;
        working = { activeSessionId: working.activeSessionId, sessions: [] };
      } else {
        lastPersistWarning = PERSIST_WARNING_MESSAGE;
        return { ok: false, droppedSessions: dropped };
      }
    }
  }
}

function persistState(state: ChatStorageState): void {
  persistWithQuotaFallback(
    state,
    (json) => {
      localStorage.setItem(STORAGE_KEY, json);
      try {
        // P314: stamp the schema version alongside every payload write.
        // Best-effort inside the quota-guarded write — a missing stamp only
        // re-runs the in-place migration next load; it must not count as a
        // payload failure and trigger an unneeded session drop.
        localStorage.setItem(SCHEMA_VERSION_KEY, String(CHAT_STORAGE_SCHEMA_VERSION));
      } catch {
        /* stamp write is best-effort */
      }
      // P250: remember the bytes only after the write actually landed — a
      // quota/private-mode throw must not mark content as ours.
      lastPersistedJson = json;
    },
    MAX_SESSIONS,
  );
}

const SESSION_TITLE_MAX = 20;
const SESSION_TITLE_FALLBACK = '新会话';

export function sessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return SESSION_TITLE_FALLBACK;
  const text = firstUser.content.trim();
  if (text.length <= SESSION_TITLE_MAX) return text;
  const sliced = text.slice(0, SESSION_TITLE_MAX).trimEnd();
  return sliced ? `${sliced}…` : SESSION_TITLE_FALLBACK;
}

/** Strip transient streaming fields before persisting, but keep the retry
 * affordance so a failed turn stays retryable after a reload. P169: keep the
 * stopped flag on a reply aborted mid-stream (the bubble keeps its 「已停止」
 * note after a refresh) and never persist a whitespace-only assistant bubble —
 * an abort before the first token must leave the trailing user message last
 * so 「生成回复」 can re-offer a reply instead of a blank bubble.
 * P243: keep a well-formed meta so the tool/latency line survives a reload —
 * normalizeReplyMeta is the single gate for both write and read, so only
 * data the loader would keep is ever written. */
export function serializeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.streaming)
    .filter((m) => m.role !== 'assistant' || m.content.trim().length > 0)
    .map(
      ({
        id,
        role,
        content,
        createdAt,
        toolEvents,
        error,
        retryPrompt,
        stopped,
        meta,
      }) => {
        const cleanMeta = normalizeReplyMeta(meta);
        return {
          id,
          role,
          content,
          createdAt,
          toolEvents: toolEvents?.map((t) => ({ ...t, status: 'done' as const })),
          ...(cleanMeta ? { meta: cleanMeta } : {}),
          ...(error ? { error: true as const, retryPrompt } : {}),
          ...(stopped ? { stopped: true as const } : {}),
        };
      },
    );
}

/**
 * P185 — ids of the sessions a `maxSessions` cap would evict: every entry
 * past the first `maxSessions` of `state.sessions` (saveChatSession keeps the
 * list sorted newest-first). Pure: never mutates the input, so the same
 * function drives both the actual trim and the eviction notice and the two
 * cannot drift apart.
 */
export function evictedSessionIds(
  state: ChatStorageState,
  maxSessions: number,
): string[] {
  return state.sessions.slice(Math.max(0, maxSessions)).map((s) => s.id);
}

let lastEvictionNotice: string | null = null;

/** Notice left by the most recent session-cap eviction in saveChatSession,
 * or null when none has happened / after clearLastEvictionNotice. Follows
 * the getLastPersistWarning module-state pattern. */
export function getLastEvictionNotice(): string | null {
  return lastEvictionNotice;
}

/** Dismiss the eviction notice — the sidebar's close affordance calls this,
 * after which re-renders must not show the notice again. */
export function clearLastEvictionNotice(): void {
  lastEvictionNotice = null;
}

export function saveChatSession(sessionId: string, messages: ChatMessage[]): void {
  const serialized = serializeMessages(messages);
  if (serialized.length === 0) return;

  // P250: after 清空全部, a stale copy of the pre-clear conversation can
  // still sit in this tab's (or another tab's) React state and reach here
  // via the save effect or a queued write. If every message predates the
  // clear, this write has no business existing — drop it so the wipe wins.
  // A genuinely new message (createdAt after the clear) always passes.
  const clearedAt = readClearedAt();
  if (
    clearedAt !== null &&
    !serialized.some(
      (m) => typeof m.createdAt === 'number' && m.createdAt > clearedAt,
    )
  ) {
    return;
  }

  const state = loadChatState();
  const existingIndex = state.sessions.findIndex((s) => s.id === sessionId);
  const existing = existingIndex >= 0 ? state.sessions[existingIndex] : undefined;
  const entry: StoredChatSession = {
    id: sessionId,
    title: existing?.customTitle ? existing.title : sessionTitle(serialized),
    updatedAt: Date.now(),
    messages: serialized,
    ...(existing?.customTitle ? { customTitle: true } : {}),
  };

  // P250: the store already shows exactly this conversation on top — writing
  // again would only bump updatedAt and fan the write → storage-event →
  // re-save ping-pong between tabs for zero information.
  if (
    existingIndex === 0 &&
    existing !== undefined &&
    state.activeSessionId === sessionId &&
    existing.title === entry.title &&
    JSON.stringify(existing.messages) === JSON.stringify(serialized)
  ) {
    return;
  }

  if (existingIndex >= 0) {
    state.sessions[existingIndex] = entry;
  } else {
    state.sessions.unshift(entry);
  }

  state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  // P159: sessions evicted by the cap lose their drafts too — the unsent
  // text is private conversation content and must not leak past deletion.
  // P185: evictedSessionIds is the single source for the cap cut — it reports
  // exactly the ids that the tail slice(MAX_SESSIONS) drops below, so the
  // trim, the purges and the notice can never drift apart.
  const evictedIds = evictedSessionIds(state, MAX_SESSIONS);
  state.sessions = state.sessions.slice(0, MAX_SESSIONS);
  purgeDrafts(evictedIds);
  // P168: same for their ArrowUp input history.
  purgeInputHistories(evictedIds);
  // P352: and their reload scroll anchor.
  purgeScrollAnchors(evictedIds);
  // P185: surface the silent eviction — the ids the cap just dropped feed a
  // dismissible sidebar notice. No eviction means no notice; a previous one
  // stays until the user dismisses it.
  if (evictedIds.length > 0) {
    lastEvictionNotice = `已自动清理 ${evictedIds.length} 段更早的对话（本机最多保留 ${MAX_SESSIONS} 段）`;
  }
  state.activeSessionId = sessionId;
  persistState(state);
}

export function setActiveSessionId(sessionId: string | null): void {
  const state = loadChatState();
  state.activeSessionId = sessionId;
  persistState(state);
}

/**
 * P253 — mint a session id on the client. The backend adopts it (same
 * convention as /api/session/restore), so the just-sent user message can be
 * persisted under the real session id at send time instead of waiting for
 * the `done` event to name the conversation.
 */
export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual id below.
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * P253 — defensive id reconciliation: if a `done` event ever names the turn
 * differently from the id the conversation was persisted under, move the
 * stored entry (and the active pointer) so one conversation keeps one id
 * instead of splitting into a truncated phantom entry plus a full one.
 * A pre-existing entry under `newId` is dropped in favour of the live
 * conversation's messages. No-op when either id is missing or they match.
 */
export function remapChatSessionId(oldId: string, newId: string): void {
  if (!oldId || !newId || oldId === newId) return;
  const state = loadChatState();
  const from = state.sessions.find((s) => s.id === oldId);
  if (!from) return;
  const remapped: StoredChatSession = { ...from, id: newId };
  state.sessions = state.sessions
    .filter((s) => s.id !== newId)
    .map((s) => (s.id === oldId ? remapped : s));
  if (state.activeSessionId === oldId) state.activeSessionId = newId;
  // P352: the reload scroll anchor follows the renamed id.
  moveScrollAnchor(oldId, newId);
  persistState(state);
}

export function getRecentSessions(): StoredChatSession[] {
  return [...loadChatState().sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) =>
      s.title && s.title !== s.id ? s : { ...s, title: sessionTitle(s.messages) },
    );
}

const CUSTOM_TITLE_MAX = 40;

/** Rename a stored session. Marks the title as custom so saveChatSession
 * keeps it. Not chat activity: activeSessionId and updatedAt are untouched. */
export function renameChatSession(sessionId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const state = loadChatState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  session.title =
    trimmed.length > CUSTOM_TITLE_MAX
      ? `${trimmed.slice(0, CUSTOM_TITLE_MAX).trimEnd()}…`
      : trimmed;
  session.customTitle = true;
  persistState(state);
}

export function deleteChatSession(sessionId: string): void {
  const state = loadChatState();
  // P265: the conversation is recoverable for 7 days — move it into the
  // recycle bin before its entry leaves the history store.
  const doomed = state.sessions.find((s) => s.id === sessionId);
  if (doomed) saveTrash(pushTrash(loadTrash(), [doomed]));
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  if (state.activeSessionId === sessionId) state.activeSessionId = null;
  persistState(state);
  // P188: a user delete invalidates the recorded eviction — the notice would
  // point at history the user just removed themselves.
  clearLastEvictionNotice();
  // P159: the unsent draft goes with the deleted conversation.
  purgeDraft(sessionId);
  // P168: so does its ArrowUp input history.
  purgeInputHistory(sessionId);
  // P352: so does its reload scroll anchor.
  purgeScrollAnchor(sessionId);
}

/** P157: fire-and-forget backend DELETEs for sessions being wiped locally.
 * Never throws, never blocks, never awaits — a rejected or synchronous-throw
 * fetch only leaves an idle backend session that the F01 TTL reaps anyway.
 * fetchImpl is injectable so tests can run without network. */
export function deleteBackendSessions(
  ids: string[],
  fetchImpl: typeof fetch = fetch,
): void {
  for (const id of ids) {
    try {
      void fetchImpl(`/api/session/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    } catch {
      /* fire-and-forget */
    }
  }
}

/** P155: bulk counterpart of deleteChatSession — wipes every stored session
 * and the active pointer with one persist call, keeping the storage shape.
 * P157: the backend copies go first — ids are collected before the local
 * list is cleared, then deleted server-side best-effort.
 * P159: the local drafts of those sessions are wiped with the same ids.
 * P168: same for their input histories — plus a sweep of the no-session
 * bucket, the pre-scoping global key and any orphan keys, so a full wipe
 * leaves nothing ArrowUp can recall.
 * P188: the eviction notice goes too — after a full wipe it would describe
 * history that no longer exists anywhere. */
export function clearAllChatSessions(): void {
  const state = loadChatState();
  const ids = state.sessions.map((s) => s.id);
  // P265: one bulk move into the recycle bin before the wipe — every
  // cleared conversation stays restorable for 7 days.
  if (state.sessions.length > 0) {
    saveTrash(pushTrash(loadTrash(), state.sessions));
  }
  deleteBackendSessions(ids);
  purgeDrafts(ids);
  purgeInputHistories(ids);
  purgeAllInputHistories();
  // P352: every session's reload scroll anchor goes with the wipe.
  purgeScrollAnchors(ids);
  clearLastEvictionNotice();
  // P250: stamp the tombstone BEFORE the empty-state write so any stale
  // saveChatSession landing between the two already sees it. Every message
  // in a pre-clear copy has createdAt ≤ this stamp and is refused.
  writeClearedAt(Date.now());
  persistState({ activeSessionId: null, sessions: [] });
}

/**
 * P247 — write a pre-clear snapshot back verbatim (the 清空全部 undo path):
 * same session ids, titles, messages and active pointer, in a single write.
 * Bypasses saveChatSession on purpose — the P250 tombstone would refuse
 * these messages (they all predate the wipe), which is right for stale
 * in-flight copies but wrong for the authoritative snapshot. The tombstone
 * is left standing so the stale-save guard keeps working afterwards.
 */
export function restoreChatState(state: ChatStorageState): void {
  persistState({
    activeSessionId: state.activeSessionId,
    sessions: state.sessions,
  });
}

/**
 * P265 — move a trashed session back into the history list and persist it
 * through the same guarded write path as every other chat-history update.
 * Returns the restored session, or null when the entry is gone. P273: a
 * same-id live session is overwritten by the trash copy, never duplicated.
 */
export function restoreChatSession(
  sessionId: string,
): StoredChatSession | null {
  const restored = restoreTrash(loadChatState(), sessionId);
  if (!restored) return null;
  persistState(restored.state);
  return restored.session;
}

export function getSession(sessionId: string): StoredChatSession | undefined {
  return loadChatState().sessions.find((s) => s.id === sessionId);
}

/** P156: resolve which conversation a stored state points at — the active
 * session's messages, or a clean empty chat when the id is missing or
 * dangling (the session was deleted/cleared in another tab). Pure: callers
 * supply the result of loadChatState(). */
export function activeChatFromState(state: ChatStorageState): {
  sessionId: string | null;
  messages: ChatMessage[];
} {
  const session = state.activeSessionId
    ? state.sessions.find((s) => s.id === state.activeSessionId)
    : undefined;
  return session
    ? { sessionId: session.id, messages: session.messages }
    : { sessionId: null, messages: [] };
}

/**
 * P250 — true when `live` would persist to exactly `stored`: the live list
 * run through serializeMessages (streaming placeholders dropped, tool
 * events closed, meta normalized) matches the stored entries field for
 * field. The storage watcher uses it to keep the current array identity
 * when a foreign write carries nothing new, so the save effect does not
 * re-fire and write the same bytes back.
 */
export function sameConversation(
  live: ChatMessage[],
  stored: ChatMessage[],
): boolean {
  if (live === stored) return true;
  return JSON.stringify(serializeMessages(live)) === JSON.stringify(stored);
}

/** P250 — shallow list equality for the sidebar's 最近对话 rows: same ids
 * in the same order with the same title, timestamp and message count. */
export function sameRecentSessions(
  a: StoredChatSession[],
  b: StoredChatSession[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.id === b[i].id &&
      s.title === b[i].title &&
      s.updatedAt === b[i].updatedAt &&
      s.messages.length === b[i].messages.length &&
      s.customTitle === b[i].customTitle,
  );
}

/**
 * P156 — cross-tab session sync. Writes to the chat-history key in another
 * tab fire a `storage` event on this window; `key === null` reports a full
 * `localStorage.clear()`. Returns the unsubscribe used as effect cleanup.
 * Guarded inside the call so SSR/tests without a window get a no-op.
 *
 * P250 — an event whose `newValue` is byte-identical to what this tab last
 * persisted is dropped: it is our own write echoing back (non-standard,
 * but instrumented/headless browsers do fire `storage` same-window) or a
 * foreign write that adds no information. Foreign writes with different
 * bytes still sync — the P156 contract is unchanged.
 */
export function watchChatStorage(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const listener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (
      event.key === STORAGE_KEY &&
      typeof event.newValue === 'string' &&
      event.newValue === lastPersistedJson
    ) {
      return;
    }
    onChange();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function clearActiveSession(): void {
  setActiveSessionId(null);
}

/**
 * P359 — what the session check found on the server. `present`: a 2xx came
 * back, the server still holds the conversation. `missing`: the server
 * answered 404 — it has no such session, the data-loss case the
 * 「上次的对话未保存」 notice reports. `unreachable`: the check never got
 * an answer or got a 5xx (offline, restarting) — claiming data loss would
 * be a false alarm, so callers must not surface the notice for it.
 */
export type SessionSyncResult = 'present' | 'missing' | 'unreachable';

/** Ensure backend has this session's conversation history (e.g. after reload). */
export async function syncSessionWithBackend(
  sessionId: string,
  messages: ChatMessage[],
  profile?: UserProfile | null,
): Promise<SessionSyncResult> {
  let serverMissing = false;
  try {
    const check = await fetch(`/api/session/${sessionId}`);
    if (check.ok) return 'present';
    // Only a definitive miss counts as lost — a 5xx says the server cannot
    // answer, not that the conversation is gone.
    serverMissing = check.status === 404;
  } catch {
    /* the check never reached the server — fall through to restore anyway */
  }

  const serialized = serializeMessages(messages).filter((m) => !m.error);
  if (serialized.length === 0) return serverMissing ? 'missing' : 'unreachable';

  try {
    await fetch('/api/session/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        messages: serialized.map((m) => ({ role: m.role, content: m.content })),
        profile: profile ?? undefined,
      }),
    });
  } catch {
    /* best-effort sync */
  }
  return serverMissing ? 'missing' : 'unreachable';
}
