/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  clearAllChatSessions,
  clearLastEvictionNotice,
  deleteChatSession,
  getLastEvictionNotice,
  getRecentSessions,
  saveChatSession,
} from '../src/lib/chatStorage';
import { shouldShowEvictionNotice } from '../src/lib/sidebarListState';

/**
 * P188 — the eviction notice is module state that used to survive 清空全部
 * and per-row deletes, leaving a banner about history that no longer exists.
 * deleteChatSession and clearAllChatSessions now clear it, and the sidebar
 * never renders the notice over an empty list. Normal eviction (the 21st
 * save) and the manual close path are unchanged.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const user = (content: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content,
});

describe('P188 · eviction notice lifecycle', () => {
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

  const triggerEviction = () => {
    for (let i = 0; i < 21; i += 1) {
      saveChatSession(`s${i}`, [user(`第 ${i} 条`)]);
    }
    expect(getLastEvictionNotice()).toBe(
      '已自动清理 1 段更早的对话（本机最多保留 20 段）',
    );
  };

  it('clear-all wipes a pending eviction notice together with the sessions', () => {
    triggerEviction();
    clearAllChatSessions();
    expect(getRecentSessions()).toHaveLength(0);
    expect(getLastEvictionNotice()).toBeNull();
  });

  it('the render gate never shows the notice over an empty session list', () => {
    expect(shouldShowEvictionNotice('已自动清理 1 段更早的对话', 0)).toBe(false);
    expect(shouldShowEvictionNotice('已自动清理 1 段更早的对话', 5)).toBe(true);
    expect(shouldShowEvictionNotice(null, 0)).toBe(false);
    expect(shouldShowEvictionNotice(null, 20)).toBe(false);
  });

  it('a single delete clears a leftover notice while other sessions remain', () => {
    triggerEviction();
    deleteChatSession('s5');
    expect(getRecentSessions()).toHaveLength(19);
    expect(getLastEvictionNotice()).toBeNull();
  });

  it('normal eviction still sets the notice and the close path still clears it', () => {
    for (let i = 0; i < 20; i += 1) {
      saveChatSession(`s${i}`, [user(`第 ${i} 条`)]);
    }
    expect(getLastEvictionNotice()).toBeNull();
    saveChatSession('s20', [user('触发淘汰')]);
    expect(getLastEvictionNotice()).not.toBeNull();

    clearLastEvictionNotice();
    expect(getLastEvictionNotice()).toBeNull();
    // No eviction on a plain update → the notice stays gone.
    saveChatSession('s20', [user('再来一条')]);
    expect(getLastEvictionNotice()).toBeNull();
  });

  it('storage paths clear the notice and the sidebar gates on the session count', () => {
    const storage = read('lib/chatStorage.ts');
    const del = storage.slice(storage.indexOf('export function deleteChatSession'));
    expect(del).toContain('clearLastEvictionNotice()');
    const clearAll = storage.slice(
      storage.indexOf('export function clearAllChatSessions'),
    );
    expect(clearAll).toContain('clearLastEvictionNotice()');

    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain(
      'shouldShowEvictionNotice(evictionNotice, recentSessions.length)',
    );
    // The notice block stays inside the 最近对话 section, under the list.
    expect(sidebar.indexOf('recent-chat-eviction')).toBeGreaterThan(
      sidebar.indexOf('</ul>'),
    );
    // The close button still dismisses through the same module function.
    expect(sidebar).toContain('clearLastEvictionNotice()');
  });
});
