/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  deleteChatSession,
  getLastPersistWarning,
  loadChatState,
  persistWithQuotaFallback,
  renameChatSession,
  saveChatSession,
  setActiveSessionId,
} from '../src/lib/chatStorage';
import type { ChatStorageState, StoredChatSession } from '../src/lib/chatStorage';

/**
 * P153 — localStorage write guard. persistWithQuotaFallback must never let a
 * QuotaExceededError escape persistState, must shed oldest sessions first,
 * keep the active session while others remain, and surface a warning.
 */

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });
const assistant = (content = 'reply'): ChatMessage => ({ id: 'a1', role: 'assistant', content });

const sess = (id: string, updatedAt: number, title = id): StoredChatSession => ({
  id,
  title,
  updatedAt,
  messages: [user('hi'), assistant()],
});

describe('P153 · storage quota fallback', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('a clean write returns {ok:true, droppedSessions:0} and writes once', () => {
    const write = vi.fn<(json: string) => void>();
    const state: ChatStorageState = {
      activeSessionId: 's1',
      sessions: [sess('s1', 2), sess('s0', 1)],
    };
    const result = persistWithQuotaFallback(state, write, 20);
    expect(result).toEqual({ ok: true, droppedSessions: 0 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(getLastPersistWarning()).toBeNull();
  });

  it('drops oldest sessions until a large payload fits and sets the warning', () => {
    let limit = 0;
    const write = vi.fn((json: string) => {
      if (json.length > limit) throw new Error('QuotaExceededError');
    });
    const state: ChatStorageState = {
      activeSessionId: 's3',
      sessions: [sess('s3', 4), sess('s2', 3), sess('s1', 2), sess('s0', 1)],
    };
    // First call (full payload) fails; allow only after one session is dropped.
    limit = JSON.stringify({
      activeSessionId: 's3',
      sessions: state.sessions.slice(0, 3),
    }).length;
    const result = persistWithQuotaFallback(state, write, 20);
    expect(result.ok).toBe(true);
    expect(result.droppedSessions).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    const persisted = JSON.parse(write.mock.calls[1][0]) as ChatStorageState;
    expect(persisted.sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect(persisted.activeSessionId).toBe('s3');
    expect(getLastPersistWarning()).toBe('本地存储空间不足，已清理最早的对话');
  });

  it('never drops the active session while other sessions remain', () => {
    const payloads: string[] = [];
    const write = vi.fn((json: string) => {
      payloads.push(json);
      if ((JSON.parse(json) as ChatStorageState).sessions.length > 1) {
        throw new Error('QuotaExceededError');
      }
    });
    const state: ChatStorageState = {
      activeSessionId: 'old', // the active session is also the oldest
      sessions: [sess('new', 3), sess('mid', 2), sess('old', 1)],
    };
    const result = persistWithQuotaFallback(state, write, 20);
    expect(result.ok).toBe(true);
    const last = JSON.parse(payloads[payloads.length - 1]) as ChatStorageState;
    expect(last.sessions.map((s) => s.id)).toEqual(['old']);
    expect(last.activeSessionId).toBe('old');
  });

  it('retries once with an empty session list keeping activeSessionId', () => {
    const write = vi.fn((json: string) => {
      if ((JSON.parse(json) as ChatStorageState).sessions.length > 0) {
        throw new Error('QuotaExceededError');
      }
    });
    const state: ChatStorageState = { activeSessionId: 's1', sessions: [sess('s1', 1)] };
    const result = persistWithQuotaFallback(state, write, 20);
    expect(result.ok).toBe(true);
    const last = JSON.parse(write.mock.calls[write.mock.calls.length - 1][0]) as ChatStorageState;
    expect(last.sessions).toEqual([]);
    expect(last.activeSessionId).toBe('s1');
  });

  it('a write that always throws returns {ok:false} without propagating', () => {
    const write = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    const state: ChatStorageState = { activeSessionId: 's1', sessions: [sess('s1', 1)] };
    let result: { ok: boolean; droppedSessions: number } | undefined;
    expect(() => {
      result = persistWithQuotaFallback(state, write, 20);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  it('clears the warning on the next clean successful write', () => {
    const failing = vi.fn((json: string) => {
      if ((JSON.parse(json) as ChatStorageState).sessions.length > 1) {
        throw new Error('QuotaExceededError');
      }
    });
    persistWithQuotaFallback(
      { activeSessionId: 's2', sessions: [sess('s2', 2), sess('s1', 1)] },
      failing,
      20,
    );
    expect(getLastPersistWarning()).not.toBeNull();
    persistWithQuotaFallback(
      { activeSessionId: 's2', sessions: [sess('s2', 2)] },
      vi.fn(),
      20,
    );
    expect(getLastPersistWarning()).toBeNull();
  });

  it('save/rename/delete/setActive roundtrip still works through the guard', () => {
    saveChatSession('s1', [user('第一条消息'), assistant('答')]);
    expect(loadChatState().activeSessionId).toBe('s1');
    renameChatSession('s1', '我的会话');
    expect(loadChatState().sessions[0].title).toBe('我的会话');
    setActiveSessionId(null);
    expect(loadChatState().activeSessionId).toBeNull();
    deleteChatSession('s1');
    const state = loadChatState();
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(getLastPersistWarning()).toBeNull();
  });
});
