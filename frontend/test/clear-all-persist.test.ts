/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllChatSessions,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P250 — 「清空全部」 used to lose the race against the write loop: the
 * 38-byte empty state landed, then a stale in-memory copy of the cleared
 * conversation was written straight back within milliseconds (38 B → 1886 B
 * → 140 more writes in 1.5 s). The fix stamps a clear timestamp under its
 * own key; saveChatSession refuses a copy whose every message predates the
 * wipe, so repeated stale saves leave the store empty while a message sent
 * after the clear still persists.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';
const CLEARED_AT_KEY = 'datingAgent.chatClearedAt';

const msg = (id: string, content: string, createdAt: number): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt,
});

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
  return store;
}

describe('P250 · clear-all beats the write-back race', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({} as Response)),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const storedSessions = () => loadChatState().sessions;
  const storedMessages = () => loadChatState().sessions.flatMap((s) => s.messages);

  it('keeps 0 sessions and 0 messages while the stale save effect keeps firing', () => {
    const stale: ChatMessage[] = [
      msg('u1', '她说明天要加班，我该说什么？', 1_000),
      { id: 'a1', role: 'assistant', content: '先祝她顺利…', createdAt: 1_001 },
    ];
    saveChatSession('s1', stale);
    expect(storedSessions()).toHaveLength(1);

    clearAllChatSessions();
    expect(storedSessions()).toHaveLength(0);

    // The same pre-clear copy keeps reaching the storage layer — an
    // in-flight effect run, another tab's queued write — and every one of
    // them must be refused.
    for (let i = 0; i < 5; i += 1) {
      saveChatSession('s1', stale);
      saveChatSession('s1', stale.map((m) => ({ ...m })));
      expect(storedSessions()).toHaveLength(0);
      expect(storedMessages()).toHaveLength(0);
    }
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      activeSessionId: null,
      sessions: [],
    });
  });

  it('still persists a message genuinely sent after the clear', () => {
    saveChatSession('s1', [msg('u1', '旧对话', 1_000)]);
    clearAllChatSessions();
    expect(storedSessions()).toHaveLength(0);

    // A bubble created after the wipe is new content, not a stale copy —
    // it must persist normally.
    saveChatSession('s2', [msg('u2', '清空后的新问题', Date.now() + 1_000)]);
    expect(storedSessions()).toHaveLength(1);
    expect(storedSessions()[0].id).toBe('s2');
    expect(storedSessions()[0].messages[0].content).toBe('清空后的新问题');
  });

  it('stamps the tombstone under its own key — the payload schema is untouched', () => {
    saveChatSession('s1', [msg('u1', '旧对话', 1_000)]);
    clearAllChatSessions();

    const stamp = Number(localStorage.getItem(CLEARED_AT_KEY));
    expect(Number.isFinite(stamp) && stamp > 0).toBe(true);
    const payload = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(['activeSessionId', 'sessions']);
  });
});
