/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DRAFT_ID } from '../src/lib/chatDrafts';
import {
  historyKey,
  LEGACY_INPUT_HISTORY_KEY,
  listInputHistoryKeys,
  loadInputHistory,
  purgeAllInputHistories,
  purgeInputHistories,
  purgeInputHistory,
  pushInputHistory,
} from '../src/lib/inputHistory';
import {
  clearAllChatSessions,
  deleteChatSession,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P06/P168 — input-history recall contract. History is per session: a push
 * in session A must never be recalled in session B, and deleting/clearing/
 * evicting a session wipes its history key. Behavioural tests exercise the
 * lib against a stubbed localStorage (node env, same approach as
 * chat-drafts.test.ts); source-level guards lock in the wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const msg = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });

const stubStorage = () => {
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
};

const okFetch = () => vi.fn<typeof fetch>(() => Promise.resolve({} as Response));

describe('P168 · per-session input history', () => {
  describe('source guards', () => {
    it('stores history under per-session keys, never the bare legacy key', () => {
      const lib = read('lib/inputHistory.ts');
      expect(lib).toContain(`'${LEGACY_INPUT_HISTORY_KEY}'`);
      expect(lib).toContain('export function historyKey(');
      expect(lib).toContain('`${HISTORY_KEY_PREFIX}');
      expect(lib).toContain('export function purgeInputHistory(');
      expect(lib).toContain('export function purgeInputHistories(');
      // The only setItem writes through historyKey — the bare global key is
      // never written.
      expect(lib).not.toContain('setItem(LEGACY_INPUT_HISTORY_KEY');
    });

    it('wires ArrowUp/ArrowDown recall to the current session id', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain('loadInputHistory(draftId)');
      // Session change resets the recall refs.
      expect(bar).toContain('historyRef.current = []');
      expect(bar).toContain('historyPosRef.current = null');
      expect(bar).toContain("e.key === 'ArrowUp'");
      expect(bar).toContain("e.key === 'ArrowDown'");
      expect(bar).toContain('selectionStart === 0');
    });

    it('records each sent message under the active session in App.tsx', () => {
      const app = read('App.tsx');
      expect(app).toContain("import { pushInputHistory } from './lib/inputHistory'");
      // P244: the send path runs through runSend (queue head drains through
      // the same body), so history recording lives there.
      const send = app.slice(app.indexOf('const runSend'));
      expect(send).toContain('pushInputHistory(sessionId, prompt)');
    });

    it('purges history alongside drafts in delete / clear-all / cap eviction', () => {
      const storage = read('lib/chatStorage.ts');
      expect(storage).toContain("from './inputHistory'");
      const del = storage.slice(storage.indexOf('export function deleteChatSession'));
      expect(del).toContain('purgeInputHistory(sessionId)');
      const clear = storage.slice(storage.indexOf('export function clearAllChatSessions'));
      expect(clear).toContain('purgeInputHistories(ids)');
      const save = storage.slice(
        storage.indexOf('export function saveChatSession'),
        storage.indexOf('export function setActiveSessionId'),
      );
      expect(save).toContain('purgeInputHistories(evictedIds)');
    });
  });

  describe('key layout', () => {
    it('derives per-session keys and falls back to the default bucket', () => {
      expect(historyKey('s1')).toBe(`${LEGACY_INPUT_HISTORY_KEY}:s1`);
      expect(historyKey('s1')).not.toBe(LEGACY_INPUT_HISTORY_KEY);
      expect(historyKey(null)).toBe(`${LEGACY_INPUT_HISTORY_KEY}:${DEFAULT_DRAFT_ID}`);
      expect(historyKey(undefined)).toBe(historyKey(null));
      expect(historyKey('')).toBe(historyKey(DEFAULT_DRAFT_ID));
    });
  });

  describe('per-session isolation', () => {
    let store: Map<string, string>;

    beforeEach(() => {
      store = stubStorage();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('a push in session A is invisible in session B, visible back in A', () => {
      pushInputHistory('sess-a', '说给 A 的私密话');
      expect(loadInputHistory('sess-b')).toEqual([]);
      expect(loadInputHistory('sess-a')).toEqual(['说给 A 的私密话']);
      // And it landed under A's key only.
      expect(store.has(historyKey('sess-a'))).toBe(true);
      expect(store.has(historyKey('sess-b'))).toBe(false);
    });

    it('each session keeps its own list order and caps', () => {
      for (const m of ['a1', 'a2', 'a3']) pushInputHistory('sess-a', m);
      pushInputHistory('sess-b', 'b1');
      expect(loadInputHistory('sess-a')).toEqual(['a1', 'a2', 'a3']);
      expect(loadInputHistory('sess-b')).toEqual(['b1']);
    });

    it('null/empty session id shares the default bucket, not another session', () => {
      pushInputHistory(null, '未建会话的消息');
      pushInputHistory('sess-a', 'a 的消息');
      expect(loadInputHistory(undefined)).toEqual(['未建会话的消息']);
      expect(loadInputHistory('sess-a')).toEqual(['a 的消息']);
    });
  });

  describe('inputHistory behaviour (unchanged contract, per session)', () => {
    let store: Map<string, string>;

    beforeEach(() => {
      store = stubStorage();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('returns [] on empty and on corrupt stored JSON', () => {
      expect(loadInputHistory('s')).toEqual([]);
      const key = historyKey('s');
      store.set(key, '{not json');
      expect(loadInputHistory('s')).toEqual([]);
      store.set(key, '{"a":1}');
      expect(loadInputHistory('s')).toEqual([]);
      store.set(key, '[1,2,3]');
      expect(loadInputHistory('s')).toEqual([]);
    });

    it('trims outer whitespace and ignores empty input', () => {
      expect(pushInputHistory('s', '  你好  ')).toEqual(['你好']);
      pushInputHistory('s', '   ');
      pushInputHistory('s', '');
      expect(loadInputHistory('s')).toEqual(['你好']);
    });

    it('drops a new entry equal to the most recent one only', () => {
      pushInputHistory('s', 'a');
      pushInputHistory('s', 'a');
      pushInputHistory('s', 'b');
      expect(loadInputHistory('s')).toEqual(['a', 'b']);
      pushInputHistory('s', 'a');
      expect(loadInputHistory('s')).toEqual(['a', 'b', 'a']);
    });

    it('keeps at most 5 entries, newest last', () => {
      for (const m of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) pushInputHistory('s', m);
      expect(loadInputHistory('s')).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
    });

    it('drops oldest entries to stay under the ~10 KB serialized cap', () => {
      const big = 'x'.repeat(3900);
      for (let i = 0; i < 5; i++) pushInputHistory('s', `${big}${i}`);
      const history = loadInputHistory('s');
      expect(history.length).toBeLessThan(5);
      expect(history.length).toBeGreaterThan(0);
      expect(JSON.stringify(history).length).toBeLessThanOrEqual(10 * 1024);
      expect(history[history.length - 1]).toBe(`${big}4`);
    });

    it('never writes the legacy global key', () => {
      pushInputHistory('sess-a', 'hello');
      pushInputHistory(null, 'no session yet');
      expect(store.has(LEGACY_INPUT_HISTORY_KEY)).toBe(false);
      for (const key of store.keys()) {
        expect(key).not.toBe(LEGACY_INPUT_HISTORY_KEY);
      }
      expect(listInputHistoryKeys().sort()).toEqual(
        [historyKey('sess-a'), historyKey(DEFAULT_DRAFT_ID)].sort(),
      );
    });

    it('does not throw when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
        clear: () => {},
      });
      expect(() => pushInputHistory('s', 'hi')).not.toThrow();
      expect(() => loadInputHistory('s')).not.toThrow();
      // The in-memory fallback is per session too.
      const loaded = loadInputHistory('s');
      expect(loaded[loaded.length - 1]).toBe('hi');
      expect(loadInputHistory('other')).toEqual([]);
    });
  });

  describe('purge on session removal', () => {
    beforeEach(() => {
      stubStorage();
      vi.stubGlobal('fetch', okFetch());
    });

    afterEach(() => vi.unstubAllGlobals());

    it('deleting a session removes exactly its history and leaves others', () => {
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      pushInputHistory('s1', 's1 private');
      pushInputHistory('s2', 's2 private');
      pushInputHistory(null, 'unsent session text');

      deleteChatSession('s1');

      expect(localStorage.getItem(historyKey('s1'))).toBeNull();
      expect(loadInputHistory('s1')).toEqual([]);
      expect(loadInputHistory('s2')).toEqual(['s2 private']);
      expect(loadInputHistory(DEFAULT_DRAFT_ID)).toEqual(['unsent session text']);
      expect(loadChatState().sessions.map((s) => s.id)).toEqual(['s2']);
    });

    it('clearAllChatSessions leaves no datingagent.input-history key behind', () => {
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      pushInputHistory('s1', 's1 private');
      pushInputHistory('s2', 's2 private');
      pushInputHistory(null, 'default bucket text');
      // Pre-P168 residue plus an orphan key must go too.
      localStorage.setItem(LEGACY_INPUT_HISTORY_KEY, '["old global"]');
      localStorage.setItem(historyKey('ghost'), '["orphan"]');
      localStorage.setItem('unrelated.key', 'keep');

      clearAllChatSessions();

      expect(listInputHistoryKeys()).toEqual([]);
      expect(localStorage.getItem(LEGACY_INPUT_HISTORY_KEY)).toBeNull();
      expect(localStorage.getItem('unrelated.key')).toBe('keep');
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
    });

    it('purges history of sessions evicted by the MAX_SESSIONS cap', () => {
      for (let i = 0; i < 20; i += 1) saveChatSession(`s${i}`, [msg(`m${i}`)]);
      pushInputHistory('s0', 'oldest session private');
      pushInputHistory('s19', 'kept session private');

      saveChatSession('s20', [msg('m20')]); // evicts s0, the oldest entry

      expect(loadChatState().sessions).toHaveLength(20);
      expect(loadChatState().sessions.some((s) => s.id === 's0')).toBe(false);
      expect(localStorage.getItem(historyKey('s0'))).toBeNull();
      expect(loadInputHistory('s19')).toEqual(['kept session private']);
    });
  });

  describe('purge helpers', () => {
    beforeEach(() => stubStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('purgeInputHistory / purgeInputHistories remove only the named keys', () => {
      pushInputHistory('a', '1');
      pushInputHistory('b', '2');
      pushInputHistory('c', '3');

      purgeInputHistory('a');
      expect(localStorage.getItem(historyKey('a'))).toBeNull();
      expect(loadInputHistory('b')).toEqual(['2']);

      purgeInputHistories(['b', 'c']);
      expect(listInputHistoryKeys()).toEqual([]);
    });

    it('purgeAllInputHistories sweeps the legacy key and every session key', () => {
      pushInputHistory('a', '1');
      pushInputHistory(null, '2');
      localStorage.setItem(LEGACY_INPUT_HISTORY_KEY, '["x"]');
      localStorage.setItem('other.key', 'y');

      purgeAllInputHistories();

      expect(listInputHistoryKeys()).toEqual([]);
      expect(localStorage.getItem('other.key')).toBe('y');
    });
  });

  describe('storage unavailable', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('never throws when every storage method throws', () => {
      const denied = () => {
        throw new Error('denied');
      };
      vi.stubGlobal('localStorage', {
        getItem: denied,
        setItem: denied,
        removeItem: denied,
        clear: denied,
        key: denied,
        get length() {
          throw new Error('denied');
        },
      });

      expect(() => purgeInputHistory('s1')).not.toThrow();
      expect(() => purgeInputHistories(['s1', 's2'])).not.toThrow();
      expect(() => purgeAllInputHistories()).not.toThrow();
      expect(listInputHistoryKeys()).toEqual([]);
      expect(() => deleteChatSession('s1')).not.toThrow();
      expect(() => clearAllChatSessions()).not.toThrow();
    });
  });
});
