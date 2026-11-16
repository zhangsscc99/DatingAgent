/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllChatSessions,
  deleteBackendSessions,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P157 — 清空全部 also deletes the backend copies. clearAllChatSessions used
 * to wipe only localStorage while the server kept the sessions for the F01
 * 30-minute TTL. deleteBackendSessions issues one fire-and-forget
 * DELETE /api/session/<encodeURIComponent(id)> per id with an injectable
 * fetch so it can be exercised without network.
 */

const msg = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });

const stubStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
};

const okFetch = () => vi.fn<typeof fetch>(() => Promise.resolve({} as Response));

describe('P157 · clear-all deletes backend sessions', () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  describe('deleteBackendSessions', () => {
    it('issues one DELETE request per id', () => {
      const fetchSpy = okFetch();
      deleteBackendSessions(['a', 'b', 'c'], fetchSpy);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      for (const [i, id] of ['a', 'b', 'c'].entries()) {
        expect(fetchSpy.mock.calls[i][0]).toBe(`/api/session/${id}`);
        expect(fetchSpy.mock.calls[i][1]).toEqual({ method: 'DELETE' });
      }
    });

    it('URL-encodes each session id', () => {
      const fetchSpy = okFetch();
      deleteBackendSessions(['id/with spaces&?='], fetchSpy);
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/session/${encodeURIComponent('id/with spaces&?=')}`,
        { method: 'DELETE' },
      );
      expect(fetchSpy.mock.calls[0][0]).not.toContain(' ');
    });

    it('swallows a rejected fetch promise', () => {
      const fetchSpy = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error('network down')),
      );
      expect(() => deleteBackendSessions(['s1'], fetchSpy)).not.toThrow();
    });

    it('swallows a synchronously throwing fetch', () => {
      const fetchSpy = vi.fn<typeof fetch>(() => {
        throw new Error('no URL base');
      });
      expect(() => deleteBackendSessions(['s1', 's2'], fetchSpy)).not.toThrow();
      // A throw on the first id must not skip the rest.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does nothing for an empty id list', () => {
      const fetchSpy = okFetch();
      deleteBackendSessions([], fetchSpy);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearAllChatSessions', () => {
    it('fires a DELETE per stored id and still empties storage', () => {
      const fetchSpy = okFetch();
      vi.stubGlobal('fetch', fetchSpy);
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      clearAllChatSessions();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
        '/api/session/s1',
        '/api/session/s2',
      ]);
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
    });

    it('clears local state even when every DELETE fails', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => Promise.reject(new Error('offline'))),
      );
      saveChatSession('s1', [msg('hi')]);
      clearAllChatSessions();
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
    });

    it('clears local state even when fetch throws synchronously', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => {
          throw new Error('sync boom');
        }),
      );
      saveChatSession('s1', [msg('hi')]);
      expect(() => clearAllChatSessions()).not.toThrow();
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
    });
  });
});
