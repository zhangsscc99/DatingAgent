import type { ChatMessage, UserProfile } from '../types';

const STORAGE_KEY = 'datingAgent.chatHistory';
const MAX_SESSIONS = 20;

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

export function loadChatState(): ChatStorageState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as ChatStorageState;
    return {
      activeSessionId: parsed.activeSessionId ?? null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
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
    (json) => localStorage.setItem(STORAGE_KEY, json),
    MAX_SESSIONS,
  );
}

const SESSION_TITLE_MAX = 20;
const SESSION_TITLE_FALLBACK = '新会话';

function sessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return SESSION_TITLE_FALLBACK;
  const text = firstUser.content.trim();
  if (text.length <= SESSION_TITLE_MAX) return text;
  const sliced = text.slice(0, SESSION_TITLE_MAX).trimEnd();
  return sliced ? `${sliced}…` : SESSION_TITLE_FALLBACK;
}

/** Strip transient streaming fields before persisting, but keep the retry
 * affordance so a failed turn stays retryable after a reload. */
export function serializeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.streaming)
    .map(({ id, role, content, createdAt, toolEvents, error, retryPrompt }) => ({
      id,
      role,
      content,
      createdAt,
      toolEvents: toolEvents?.map((t) => ({ ...t, status: 'done' as const })),
      ...(error ? { error: true as const, retryPrompt } : {}),
    }));
}

export function saveChatSession(sessionId: string, messages: ChatMessage[]): void {
  const serialized = serializeMessages(messages);
  if (serialized.length === 0) return;

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

  if (existingIndex >= 0) {
    state.sessions[existingIndex] = entry;
  } else {
    state.sessions.unshift(entry);
  }

  state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  state.sessions = state.sessions.slice(0, MAX_SESSIONS);
  state.activeSessionId = sessionId;
  persistState(state);
}

export function setActiveSessionId(sessionId: string | null): void {
  const state = loadChatState();
  state.activeSessionId = sessionId;
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
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  if (state.activeSessionId === sessionId) state.activeSessionId = null;
  persistState(state);
}

/** P155: bulk counterpart of deleteChatSession — wipes every stored session
 * and the active pointer with one persist call, keeping the storage shape. */
export function clearAllChatSessions(): void {
  persistState({ activeSessionId: null, sessions: [] });
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
 * P156 — cross-tab session sync. Writes to the chat-history key in another
 * tab fire a `storage` event on this window; `key === null` reports a full
 * `localStorage.clear()`. Returns the unsubscribe used as effect cleanup.
 * Guarded inside the call so SSR/tests without a window get a no-op.
 */
export function watchChatStorage(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const listener = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function clearActiveSession(): void {
  setActiveSessionId(null);
}

/** Ensure backend has this session's conversation history (e.g. after reload). */
export async function syncSessionWithBackend(
  sessionId: string,
  messages: ChatMessage[],
  profile?: UserProfile | null,
): Promise<void> {
  try {
    const check = await fetch(`/api/session/${sessionId}`);
    if (check.ok) return;
  } catch {
    /* fall through to restore */
  }

  const serialized = serializeMessages(messages).filter((m) => !m.error);
  if (serialized.length === 0) return;

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
}
