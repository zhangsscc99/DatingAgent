/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearAllChatSessions,
  loadChatState,
  saveChatSession,
  setActiveSessionId,
} from '../src/lib/chatStorage';
import type { ChatStorageState } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P155 — bulk clear of 最近对话. Source-level guards (same approach as
 * delete-session.test.ts) lock in the header button wiring; the behavioural
 * blocks exercise clearAllChatSessions against a stubbed localStorage.
 * P228 moved the confirm step into the app's own ConfirmDialog (covered by
 * confirm-dialog.test.ts) — the sidebar button now only requests the clear.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const STORAGE_KEY = 'datingAgent.chatHistory';

const msg = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });

describe('P155 · clear all history chats', () => {
  describe('source guards', () => {
    it('renders a labelled dim clear-all button in the 最近对话 header, not per row', () => {
      const sidebar = read('components/Sidebar.tsx');
      const header = sidebar.indexOf('recent-chats-header');
      const button = sidebar.indexOf('recent-chat-clear-all');
      const filter = sidebar.indexOf('recent-chat-filter');
      expect(header).toBeGreaterThan(-1);
      // The button sits inside the section header, before the filter input.
      expect(button).toBeGreaterThan(header);
      expect(button).toBeLessThan(filter);
      expect(sidebar).toContain('aria-label="清空全部历史对话"');
      expect(sidebar).toContain('清空全部');
      // Per-row actions remain rename/delete only — the bulk button is unique.
      expect(sidebar.indexOf('recent-chat-clear-all')).toBe(
        sidebar.lastIndexOf('recent-chat-clear-all'),
      );
    });

    it('requests the clear through the in-app dialog and disables while busy or empty', () => {
      const sidebar = read('components/Sidebar.tsx');
      // P228: no native confirm anywhere — the button only asks App to open
      // the ConfirmDialog, which keeps the original copy.
      expect(sidebar).not.toContain('confirm(');
      const btn = sidebar.slice(
        sidebar.indexOf('recent-chat-clear-all'),
        sidebar.indexOf('recent-chat-filter'),
      );
      expect(btn).toContain('disabled={busy || recentSessions.length === 0}');
      expect(btn).toContain('onClearAllChats?.()');
    });

    it('wires App to confirm first, then clear the store and reset the chat surface', () => {
      const app = read('App.tsx');
      expect(app).not.toContain('window.confirm');
      // P266: the description now names the counts via the shared builder.
      expect(app).toContain('describeConfirm(confirmRequest)');
      expect(app).toContain('onClearAllChats={requestClearAllChats}');
      expect(app).toContain('onClearAll={requestClearAllChats}');
      const handler = app.slice(app.indexOf('const handleClearAllChats'));
      expect(handler).toContain('clearAllChatSessions()');
      expect(handler).toContain('setRecentSessions([])');
      expect(handler).toContain('setMessages([])');
      expect(handler).toContain('setSessionId(null)');
      // No stale outage banner or error toast after the reset.
      expect(handler).toContain('setServiceDownBanner(false)');
      expect(handler).toContain('toastCtl.dismiss()');
    });
  });

  describe('clearAllChatSessions behaviour', () => {
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

    it('empties the session list, nulls activeSessionId, and keeps the shape', () => {
      saveChatSession('s1', [msg('第一条')]);
      saveChatSession('s2', [msg('第二条')]);
      setActiveSessionId('s2');
      clearAllChatSessions();
      const state = loadChatState();
      expect(state).toEqual({ activeSessionId: null, sessions: [] });
    });

    it('performs a single storage write', () => {
      const setSpy = vi.fn<(k: string, v: string) => void>((k, v) => {
        void k;
        void v;
      });
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify({
          activeSessionId: 's1',
          sessions: [
            { id: 's1', title: 't', updatedAt: 1, messages: [msg('hi')] },
          ],
        } satisfies ChatStorageState),
        setItem: setSpy,
        removeItem: () => {},
        clear: () => {},
      });
      clearAllChatSessions();
      // P250: the clear still persists the empty state with one write to the
      // history key (a sibling tombstone key also records the clear time).
      const historyWrites = setSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
      expect(historyWrites).toHaveLength(1);
      expect(historyWrites[0][1]).toBe(
        JSON.stringify({ activeSessionId: null, sessions: [] }),
      );
    });
  });

  describe('confirm gate', () => {
    it('the danger button is the only path that reaches handleClearAllChats', () => {
      const app = read('App.tsx');
      // The request handler only opens the dialog — no clearing inside it.
      const request = app.slice(
        app.indexOf('const requestClearAllChats'),
        app.indexOf('const handleClearAllChats'),
      );
      expect(request).not.toContain('clearAllChatSessions()');
      // …and the clear itself is invoked from ConfirmDialog's onConfirm.
      expect(app).toContain('<ConfirmDialog');
      const onConfirm = app.slice(app.indexOf('onConfirm={'));
      expect(onConfirm).toContain('handleClearAllChats()');
    });
  });
});
