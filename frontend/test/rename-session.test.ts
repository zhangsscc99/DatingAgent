/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  getRecentSessions,
  loadChatState,
  renameChatSession,
  saveChatSession,
} from '../src/lib/chatStorage';

/**
 * P149 — sidebar session rename contract. Source-level guards (same approach
 * as delete-session.test.ts) lock in the row wiring; the behavioural block
 * exercises renameChatSession/saveChatSession against a stubbed localStorage
 * (vitest runs in the node environment, so a minimal in-memory stub stands
 * in for the browser API).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const STORAGE_KEY = 'datingAgent.chatHistory';

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });
const assistant = (content = 'reply'): ChatMessage => ({ id: 'a1', role: 'assistant', content });

function seed(sessions: object[], activeSessionId: string | null = null) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeSessionId, sessions }));
}

describe('P149 · rename history session', () => {
  describe('source guards', () => {
    it('exposes renameChatSession with the trim/cap/ignore-empty contract', () => {
      const storage = read('lib/chatStorage.ts');
      expect(storage).toContain('export function renameChatSession(sessionId: string, title: string): void');
      const fn = storage.slice(
        storage.indexOf('export function renameChatSession'),
        storage.indexOf('export function deleteChatSession'),
      );
      expect(fn).toContain('title.trim()');
      expect(fn).toContain('customTitle = true');
      expect(fn).toContain('persistState(state)');
      // Renaming is not activity: no updatedAt bump, no activeSessionId touch.
      expect(fn).not.toContain('updatedAt =');
      expect(fn).not.toContain('activeSessionId =');
    });

    it('keeps the custom title on subsequent saves', () => {
      const storage = read('lib/chatStorage.ts');
      expect(storage).toContain('customTitle?: boolean');
      expect(storage).toContain('existing?.customTitle ? existing.title : sessionTitle(serialized)');
    });

    it('renders a labelled, busy-disabled rename button as a sibling inside the row', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain('recent-chat-rename');
      expect(sidebar).toContain('重命名对话：');
      expect(sidebar).toContain('onRenameChat?.(s.id, next)');
      expect(sidebar).toContain('maxLength={40}');
      // Sibling, not nested: the rename button appears after the switch
      // button's closing tag inside the same <li>.
      const switchClose = sidebar.indexOf('</button>', sidebar.indexOf('onSelectChat'));
      const renameBtn = sidebar.indexOf('recent-chat-rename');
      expect(renameBtn).toBeGreaterThan(switchClose);
      // Inline edit: Enter/blur commit, Escape cancels, one row at a time.
      expect(sidebar).toContain("e.key === 'Enter'");
      expect(sidebar).toContain("e.key === 'Escape'");
      expect(sidebar).toContain('onBlur={commitRename}');
      expect(sidebar).toContain('editingId === s.id');
    });

    it('wires the rename handler without touching the active chat', () => {
      const app = read('App.tsx');
      expect(app).toContain('onRenameChat={handleRenameChat}');
      const handler = app.slice(app.indexOf('const handleRenameChat'));
      expect(handler).toContain('renameChatSession(id, title)');
      expect(handler).toContain('setRecentSessions(getRecentSessions())');
      expect(handler).not.toContain('setMessages(');
      expect(handler).not.toContain('setSessionId(');
    });
  });

  describe('renameChatSession behaviour', () => {
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

    it('trims the title and marks it custom', () => {
      seed([{ id: 's1', title: '你好', updatedAt: 1, messages: [user('你好'), assistant()] }]);
      renameChatSession('s1', '  我的新标题  ');
      const s = loadChatState().sessions[0];
      expect(s.title).toBe('我的新标题');
      expect(s.customTitle).toBe(true);
    });

    it('caps the title at 40 chars with an ellipsis', () => {
      seed([{ id: 's1', title: 't', updatedAt: 1, messages: [user('hi'), assistant()] }]);
      renameChatSession('s1', 'x'.repeat(45));
      const s = loadChatState().sessions[0];
      expect(s.title).toBe(`${'x'.repeat(40)}…`);
    });

    it('ignores empty and whitespace-only input', () => {
      seed([{ id: 's1', title: 'original', updatedAt: 1, messages: [user('hi'), assistant()] }]);
      renameChatSession('s1', '   ');
      renameChatSession('s1', '');
      const s = loadChatState().sessions[0];
      expect(s.title).toBe('original');
      expect(s.customTitle).toBeUndefined();
    });

    it('does not bump updatedAt or touch activeSessionId', () => {
      seed(
        [{ id: 's1', title: 't', updatedAt: 1234, messages: [user('hi'), assistant()] }],
        'other',
      );
      renameChatSession('s1', 'renamed');
      const state = loadChatState();
      expect(state.sessions[0].updatedAt).toBe(1234);
      expect(state.activeSessionId).toBe('other');
    });

    it('is a no-op for unknown session ids', () => {
      seed([{ id: 's1', title: 't', updatedAt: 1, messages: [user('hi'), assistant()] }]);
      expect(() => renameChatSession('nope', 'x')).not.toThrow();
      expect(loadChatState().sessions[0].title).toBe('t');
    });

    it('keeps the custom title after a following saveChatSession', () => {
      seed([{ id: 's1', title: '你好', updatedAt: 1, messages: [user('你好'), assistant()] }]);
      renameChatSession('s1', '周末约会计划');
      saveChatSession('s1', [user('完全不同的问题'), assistant('answer')]);
      const s = loadChatState().sessions[0];
      expect(s.title).toBe('周末约会计划');
      expect(s.customTitle).toBe(true);
    });

    it('still derives titles for legacy entries without the flag', () => {
      // Backward compatible load: no customTitle field in the stored entry.
      seed([{ id: 's1', title: 'old', updatedAt: 1, messages: [user('第一条消息'), assistant()] }]);
      saveChatSession('s1', [user('第二条消息会作为新标题'), assistant('answer')]);
      const s = loadChatState().sessions[0];
      expect(s.title).toBe('第二条消息会作为新标题');
      expect(s.customTitle).toBeUndefined();
    });

    it('surfaces the renamed title through getRecentSessions', () => {
      seed([{ id: 's1', title: 't', updatedAt: 1, messages: [user('hi'), assistant()] }]);
      renameChatSession('s1', 'renamed');
      expect(getRecentSessions()[0].title).toBe('renamed');
    });
  });
});
