/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterRecentChats,
  recentChatEmptyState,
} from '../src/lib/recentChatFilter';
import {
  clearAllChatSessions,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P369 — machine assertions for the sidebar 筛选对话 + 清空全部对话 pair,
 * which walkthroughs could only eyeball as 存疑. vitest runs in the node
 * environment, so: (a) the filter contract is exercised through the real
 * recentChatFilter module the sidebar now imports, (b) the empty state's
 * DOM hook (data-testid="recent-chat-empty") and gate are pinned by source
 * guards, and (c) the clear-all chain — sidebar button → ConfirmDialog →
 * store wipe + DELETE /api/session/:id — is verified the same way the
 * neighbouring clear-all tests do it. The backend half of the count
 * decrement (GET /api/sessions −1 per DELETE) lives in
 * backend/test/sessions-clear-count.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const msg = (content: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content,
});

const session = (
  id: string,
  title: string,
  messages: ChatMessage[] = [],
): StoredChatSession => ({ id, title, updatedAt: 1, messages });

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

describe('P369 · sidebar filter + clear-all machine assertions', () => {
  describe('filterRecentChats + recentChatEmptyState', () => {
    const chats = [
      session('s1', '周末约会计划'),
      session('s2', '资料优化建议'),
      session('s3', '聊天回复', [msg('她昨天提到想去露营')]),
    ];

    it('a query with zero matches yields 0 cards and flags the empty state', () => {
      const visible = filterRecentChats(chats, '不存在');
      expect(visible).toHaveLength(0);
      expect(recentChatEmptyState('不存在', visible.length)).toBe(true);
    });

    it('a query with one match returns exactly that chat', () => {
      const visible = filterRecentChats(chats, '约会');
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('s1');
      expect(recentChatEmptyState('约会', visible.length)).toBe(false);
    });

    it('a body-only match keeps its chat — the filter searches messages too', () => {
      const visible = filterRecentChats(chats, '露营');
      expect(visible.map((s) => s.id)).toEqual(['s3']);
    });

    it('an empty query returns every chat and never flags the empty state', () => {
      const visible = filterRecentChats(chats, '');
      expect(visible).toBe(chats);
      expect(visible).toHaveLength(3);
      expect(recentChatEmptyState('', 0)).toBe(false);
      expect(recentChatEmptyState('', visible.length)).toBe(false);
    });

    it('a whitespace-only query is trimmed — same as empty', () => {
      const visible = filterRecentChats(chats, '   ');
      expect(visible).toHaveLength(3);
      expect(recentChatEmptyState('   ', 0)).toBe(false);
    });

    it('matching is case-insensitive on titles', () => {
      const mixed = [session('s9', 'Date Night ABC')];
      expect(filterRecentChats(mixed, 'abc')).toHaveLength(1);
      expect(filterRecentChats(mixed, 'ABC')).toHaveLength(1);
    });
  });

  describe('clear-all → confirm requested, then count decrement', () => {
    beforeEach(() => stubStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('confirm wipe empties the stored count and fires one DELETE per id', () => {
      const fetchSpy = vi.fn<typeof fetch>(() =>
        Promise.resolve({} as Response),
      );
      vi.stubGlobal('fetch', fetchSpy);
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      expect(loadChatState().sessions).toHaveLength(2);

      clearAllChatSessions();

      // The local count drops to zero; each backend copy gets the same
      // fire-and-forget DELETE the per-row delete uses — the backend test
      // proves each one decrements GET /api/sessions by exactly 1.
      expect(loadChatState().sessions).toHaveLength(0);
      expect(loadChatState().activeSessionId).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
        '/api/session/s1',
        '/api/session/s2',
      ]);
      for (const call of fetchSpy.mock.calls) {
        expect(call[1]).toEqual({ method: 'DELETE' });
      }
    });
  });

  describe('source guards', () => {
    const sidebar = read('components/Sidebar.tsx');
    const app = read('App.tsx');

    it('the sidebar filters through recentChatFilter, not an inline matcher', () => {
      expect(sidebar).toContain("from '../lib/recentChatFilter'");
      expect(sidebar).toContain(
        'filterRecentChats(recentSessions, filterQuery)',
      );
    });

    it('the empty state carries data-testid="recent-chat-empty" and only mounts on an active zero-match query', () => {
      const anchor = sidebar.indexOf('data-testid="recent-chat-empty"');
      expect(anchor).toBeGreaterThan(-1);
      const gateStart = sidebar.indexOf('shouldShowFilterEmptyHint(');
      expect(gateStart).toBeGreaterThan(-1);
      expect(gateStart).toBeLessThan(anchor);
      const gate = sidebar.slice(gateStart, anchor);
      expect(gate).toContain('shouldShowFilterEmptyHint(');
      expect(gate).toContain(
        'recentChatEmptyState(filterQuery, visibleSessions.length)',
      );
      const li = sidebar.slice(anchor, sidebar.indexOf('</li>', anchor));
      expect(li).toContain('data-testid="recent-chat-empty"');
      expect(li).toContain('没有匹配「{filterQuery.trim()}」的对话');
    });

    it('the 清空全部对话 button only requests the clear — never clears inline', () => {
      expect(sidebar).not.toContain('clearAllChatSessions');
      expect(sidebar).not.toContain('confirm(');
      const btn = sidebar.slice(
        sidebar.indexOf('recent-chat-clear-all'),
        sidebar.indexOf('recent-chat-filter'),
      );
      expect(btn).toContain('onClearAllChats?.()');
      expect(btn).toContain('disabled={busy}');
      expect(sidebar).toContain('aria-label={CLEAR_ALL_LABEL}');
    });

    it('App routes the request through ConfirmDialog before any wipe', () => {
      expect(app).toContain('onClearAllChats={requestClearAllChats}');
      // The request handler only opens the dialog — no clearing inside it.
      const request = app.slice(
        app.indexOf('const requestClearAllChats'),
        app.indexOf('const handleClearAllChats'),
      );
      expect(request).not.toContain('clearAllChatSessions()');
      expect(request).toContain('setConfirmRequest(');
      // …and the wipe itself is invoked from ConfirmDialog's onConfirm.
      expect(app).toContain('<ConfirmDialog');
      const onConfirm = app.slice(app.indexOf('onConfirm={'));
      expect(onConfirm).toContain('handleClearAllChats()');
      const handler = app.slice(app.indexOf('const handleClearAllChats'));
      expect(handler).toContain('clearAllChatSessions()');
      expect(handler).toContain('setRecentSessions([])');
    });
  });
});
