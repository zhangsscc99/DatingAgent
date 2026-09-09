import type { ChatMessage, UserProfile } from '../types';

const STORAGE_KEY = 'datingAgent.chatHistory';
const MAX_SESSIONS = 20;

export interface StoredChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
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

function persistState(state: ChatStorageState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function sessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return '新对话';
  const text = firstUser.content.trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

/** Strip transient streaming/error fields before persisting */
export function serializeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.streaming)
    .map(({ id, role, content, toolEvents }) => ({
      id,
      role,
      content,
      toolEvents: toolEvents?.map((t) => ({ ...t, status: 'done' as const })),
    }));
}

export function saveChatSession(sessionId: string, messages: ChatMessage[]): void {
  const serialized = serializeMessages(messages);
  if (serialized.length === 0) return;

  const state = loadChatState();
  const existing = state.sessions.findIndex((s) => s.id === sessionId);
  const entry: StoredChatSession = {
    id: sessionId,
    title: sessionTitle(serialized),
    updatedAt: Date.now(),
    messages: serialized,
  };

  if (existing >= 0) {
    state.sessions[existing] = entry;
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
  return loadChatState().sessions;
}

export function getSession(sessionId: string): StoredChatSession | undefined {
  return loadChatState().sessions.find((s) => s.id === sessionId);
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

  const serialized = serializeMessages(messages);
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
