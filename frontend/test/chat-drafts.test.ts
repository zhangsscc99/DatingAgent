/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DRAFT_ID,
  DRAFT_PREFIX,
  draftStorageKey,
  listDraftKeys,
  purgeDraft,
  purgeDrafts,
  sweepOrphanDrafts,
} from '../src/lib/chatDrafts';
import {
  clearAllChatSessions,
  deleteChatSession,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P159 — drafts of deleted/cleared/evicted sessions must not linger.
 * Source-level guards (same approach as delete-session.test.ts) lock in the
 * wiring between the storage mutators, the shared key helpers, and the App
 * mount sweep; the behavioural blocks exercise the draft lifecycle against
 * a stubbed localStorage (vitest runs in node, no DOM).
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

describe('P159 · draft cleanup on session removal', () => {
  describe('source guards', () => {
    it('routes delete, clear-all and cap eviction through the draft purges', () => {
      const storage = read('lib/chatStorage.ts');
      expect(storage).toContain("from './chatDrafts'");
      const del = storage.slice(storage.indexOf('export function deleteChatSession'));
      expect(del).toContain('purgeDraft(sessionId)');
      const clear = storage.slice(storage.indexOf('export function clearAllChatSessions'));
      expect(clear).toContain('purgeDrafts(ids)');
      const save = storage.slice(
        storage.indexOf('export function saveChatSession'),
        storage.indexOf('export function setActiveSessionId'),
      );
      expect(save).toContain('slice(MAX_SESSIONS)');
      expect(save).toContain('purgeDrafts');
    });

    it('shares the draft key helpers in InputBar — no local prefix copy', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain("from '../lib/chatDrafts'");
      expect(bar).not.toContain('`datingagent-draft:');
      expect(bar).not.toContain("'datingagent-draft:");
      // Same 4 KB cap and clear-on-send behaviour as before.
      expect(bar).toContain('MAX_DRAFT_CHARS = 4096');
      expect(bar).toContain('localStorage.removeItem(draftStorageKey(draftId))');
    });

    it('sweeps orphan drafts once on App mount', () => {
      const app = read('App.tsx');
      expect(app).toContain("from './lib/chatDrafts'");
      expect(app).toContain('sweepOrphanDrafts');
      expect(app).toContain('loadChatState().sessions.map((s) => s.id)');
    });
  });

  describe('draft key helpers', () => {
    beforeEach(() => stubStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the exact key format', () => {
      expect(draftStorageKey('abc')).toBe('datingagent-draft:abc');
      expect(draftStorageKey(DEFAULT_DRAFT_ID)).toBe(`${DRAFT_PREFIX}default`);
    });

    it('lists only prefixed keys', () => {
      localStorage.setItem(draftStorageKey('s1'), 'a');
      localStorage.setItem(draftStorageKey('s2'), 'b');
      localStorage.setItem('datingAgent.chatHistory', '{}');
      expect(listDraftKeys().sort()).toEqual([
        draftStorageKey('s1'),
        draftStorageKey('s2'),
      ]);
    });
  });

  describe('purge on session removal', () => {
    beforeEach(() => {
      stubStorage();
      vi.stubGlobal('fetch', okFetch());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('deleting a session removes exactly its draft and leaves others', () => {
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      localStorage.setItem(draftStorageKey('s1'), 'draft one');
      localStorage.setItem(draftStorageKey('s2'), 'draft two');
      localStorage.setItem(draftStorageKey(DEFAULT_DRAFT_ID), 'unsent');

      deleteChatSession('s1');

      expect(localStorage.getItem(draftStorageKey('s1'))).toBeNull();
      expect(localStorage.getItem(draftStorageKey('s2'))).toBe('draft two');
      expect(localStorage.getItem(draftStorageKey(DEFAULT_DRAFT_ID))).toBe('unsent');
      // The session itself is gone as before.
      expect(loadChatState().sessions.map((s) => s.id)).toEqual(['s2']);
    });

    it('clearAllChatSessions leaves no datingagent-draft: key behind', () => {
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      localStorage.setItem(draftStorageKey('s1'), 'draft one');
      localStorage.setItem(draftStorageKey('s2'), 'draft two');
      localStorage.setItem('unrelated.key', 'keep');

      clearAllChatSessions();

      expect(listDraftKeys()).toEqual([]);
      expect(localStorage.getItem('unrelated.key')).toBe('keep');
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
    });

    it('purges drafts of sessions evicted by the MAX_SESSIONS cap', () => {
      for (let i = 0; i < 20; i += 1) saveChatSession(`s${i}`, [msg(`m${i}`)]);
      localStorage.setItem(draftStorageKey('s0'), 'oldest draft');
      localStorage.setItem(draftStorageKey('s19'), 'kept draft');

      saveChatSession('s20', [msg('m20')]); // evicts s0, the oldest entry

      expect(loadChatState().sessions).toHaveLength(20);
      expect(loadChatState().sessions.some((s) => s.id === 's0')).toBe(false);
      expect(localStorage.getItem(draftStorageKey('s0'))).toBeNull();
      expect(localStorage.getItem(draftStorageKey('s19'))).toBe('kept draft');
    });
  });

  describe('sweepOrphanDrafts', () => {
    beforeEach(() => stubStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('removes only unknown ids and returns the removed count', () => {
      for (const id of ['keep', 'gone1', 'gone2']) {
        localStorage.setItem(draftStorageKey(id), 'x');
      }
      localStorage.setItem('other.key', 'y');

      expect(sweepOrphanDrafts(['keep'])).toBe(2);

      expect(listDraftKeys()).toEqual([draftStorageKey('keep')]);
      expect(localStorage.getItem('other.key')).toBe('y');
      // A second sweep is a no-op.
      expect(sweepOrphanDrafts(['keep'])).toBe(0);
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

      expect(() => purgeDraft('s1')).not.toThrow();
      expect(() => purgeDrafts(['s1', 's2'])).not.toThrow();
      expect(listDraftKeys()).toEqual([]);
      expect(sweepOrphanDrafts(['keep'])).toBe(0);
      // Callers stay alive too — deletion still does not throw.
      expect(() => deleteChatSession('s1')).not.toThrow();
      expect(() => clearAllChatSessions()).not.toThrow();
    });
  });
});
