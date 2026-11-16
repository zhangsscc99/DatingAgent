/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  clearLastEvictionNotice,
  evictedSessionIds,
  getLastEvictionNotice,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatStorageState, StoredChatSession } from '../src/lib/chatStorage';

/**
 * P185 — the 20-session cap used to drop the oldest conversations without a
 * trace. evictedSessionIds is the single source for both the trim and the
 * notice so they cannot drift; getLastEvictionNotice follows the
 * getLastPersistWarning module-state pattern, and the sidebar renders a
 * dismissible dim line under 最近对话.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });
const assistant = (content = 'reply'): ChatMessage => ({ id: 'a1', role: 'assistant', content });

const sess = (id: string, updatedAt: number): StoredChatSession => ({
  id,
  title: id,
  updatedAt,
  messages: [user('hi'), assistant()],
});

describe('P185 · session-cap eviction notice', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    clearLastEvictionNotice();
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('under the cap nothing is evicted and no notice is produced', () => {
    for (let i = 0; i < 5; i += 1) {
      saveChatSession(`s${i}`, [user(`第 ${i} 条`), assistant()]);
    }
    expect(loadChatState().sessions).toHaveLength(5);
    expect(getLastEvictionNotice()).toBeNull();

    const state: ChatStorageState = {
      activeSessionId: 'b',
      sessions: [sess('b', 2), sess('a', 1)],
    };
    expect(evictedSessionIds(state, 20)).toEqual([]);
  });

  it('the 21st session evicts exactly the oldest id and records the notice', () => {
    for (let i = 0; i < 20; i += 1) {
      saveChatSession(`s${i}`, [user(`第 ${i} 条`)]);
    }
    expect(getLastEvictionNotice()).toBeNull();

    saveChatSession('s20', [user('触发淘汰')]);
    const stored = loadChatState();
    expect(stored.sessions).toHaveLength(20);
    expect(stored.sessions.map((s) => s.id)).toContain('s20');
    expect(stored.sessions.map((s) => s.id)).not.toContain('s0');
    expect(getLastEvictionNotice()).toBe(
      '已自动清理 1 段更早的对话（本机最多保留 20 段）',
    );
  });

  it('a store already past the cap evicts the whole overflow in one save', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeSessionId: null,
        sessions: Array.from({ length: 23 }, (_, i) => sess(`old${i}`, 100 - i)),
      }),
    );
    saveChatSession('fresh', [user('新会话')]);
    const stored = loadChatState();
    // 24 stored - 20 kept: fresh is newest, the four oldest (old19…old22) go.
    expect(stored.sessions.map((s) => s.id)).toEqual([
      'fresh',
      ...Array.from({ length: 19 }, (_, i) => `old${i}`),
    ]);
    expect(getLastEvictionNotice()).toBe(
      '已自动清理 4 段更早的对话（本机最多保留 20 段）',
    );
  });

  it('a later non-evicting save keeps the notice until it is dismissed', () => {
    for (let i = 0; i < 21; i += 1) {
      saveChatSession(`s${i}`, [user(`第 ${i} 条`)]);
    }
    expect(getLastEvictionNotice()).not.toBeNull();

    // Updating an existing session evicts nothing — the recorded eviction
    // stays visible until the user explicitly closes it.
    saveChatSession('s20', [user('再来一条')]);
    expect(getLastEvictionNotice()).not.toBeNull();

    clearLastEvictionNotice();
    expect(getLastEvictionNotice()).toBeNull();
    saveChatSession('s20', [user('还有一条')]);
    expect(getLastEvictionNotice()).toBeNull();
  });

  it('evictedSessionIds is pure — the input state is never mutated', () => {
    const sessions = Array.from({ length: 23 }, (_, i) => sess(`s${i}`, 100 - i));
    const state: ChatStorageState = { activeSessionId: 's0', sessions };
    const before = sessions.map((s) => s.id);

    expect(evictedSessionIds(state, 20)).toEqual(['s20', 's21', 's22']);
    expect(evictedSessionIds(state, 20)).toEqual(['s20', 's21', 's22']);
    expect(state.sessions).toBe(sessions);
    expect(sessions.map((s) => s.id)).toEqual(before);
    expect(evictedSessionIds({ activeSessionId: null, sessions: [] }, 20)).toEqual(
      [],
    );
  });

  it('saveChatSession trims through evictedSessionIds and the sidebar renders a dismissible notice', () => {
    const storage = read('lib/chatStorage.ts');
    expect(storage).toContain('export function evictedSessionIds');
    expect(storage).toContain('export function getLastEvictionNotice');
    expect(storage).toContain('export function clearLastEvictionNotice');
    const save = storage.slice(storage.indexOf('export function saveChatSession'));
    expect(save).toContain('evictedSessionIds(state, MAX_SESSIONS)');
    expect(save).toContain('lastEvictionNotice');

    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('getLastEvictionNotice()');
    expect(sidebar).toContain('clearLastEvictionNotice()');
    expect(sidebar).toContain('recent-chat-eviction');
    // The notice sits under the session list, inside the 最近对话 section.
    expect(sidebar.indexOf('recent-chat-eviction')).toBeGreaterThan(
      sidebar.indexOf('</ul>'),
    );

    const css = read('components/Sidebar.css');
    expect(css).toContain('.recent-chat-eviction');
    expect(css).toContain('.recent-chat-eviction-close');
  });
});
