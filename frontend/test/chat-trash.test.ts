/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTrash,
  loadTrash,
  pruneTrash,
  pushTrash,
  restoreTrash,
  saveTrash,
  TRASH_KEY,
  TRASH_MAX_SESSIONS,
  TRASH_TTL_MS,
} from '../src/lib/chatTrash';
import type { TrashEntry } from '../src/lib/chatTrash';
import {
  clearAllChatSessions,
  deleteChatSession,
  loadChatState,
  restoreChatSession,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { StoredChatSession } from '../src/lib/chatStorage';
import { createClearAllUndo } from '../src/lib/clearAllUndo';
import { shouldShowTrashEntry } from '../src/lib/sidebarListState';
import type { ChatMessage } from '../src/types';

/**
 * P265 — deleted/cleared conversations used to vanish permanently: the
 * localStorage copy was the only copy and the confirm dialog ended the
 * story. They now move into a 7-day, 50-session recycle bin under its own
 * key (`datingAgent.trash`) — the chatHistory schema is untouched, every
 * storage access is guarded, and the sidebar gains a 回收站 entry + sheet.
 * Behavioural blocks drive the pure core and the storage wiring against a
 * stubbed localStorage; source guards lock the UI wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const user = (content: string, createdAt = 1_000): ChatMessage => ({
  id: `u-${createdAt}`,
  role: 'user',
  content,
  createdAt,
});

const assistant = (content: string, createdAt = 1_001): ChatMessage => ({
  id: `a-${createdAt}`,
  role: 'assistant',
  content,
  createdAt,
});

const session = (
  id: string,
  messages: ChatMessage[],
  updatedAt = 1,
): StoredChatSession => ({ id, title: `标题 ${id}`, updatedAt, messages });

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

describe('P265 · recycle bin', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({} as Response)));
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('deleteChatSession moves the session into the trash', () => {
    it('the deleted session appears in loadTrash() and leaves chatHistory', () => {
      saveChatSession('s1', [user('你好'), assistant('在的')]);
      saveChatSession('s2', [user('第二条')]);
      expect(loadTrash()).toHaveLength(0);

      deleteChatSession('s1');

      const state = loadChatState();
      expect(state.sessions.map((s) => s.id)).toEqual(['s2']);
      const trash = loadTrash();
      expect(trash).toHaveLength(1);
      expect(trash[0].sessionId).toBe('s1');
      expect(trash[0].messageCount).toBe(2);
      expect(trash[0].messages.map((m) => m.content)).toEqual([
        '你好',
        '在的',
      ]);
      expect(Number.isFinite(trash[0].deletedAt)).toBe(true);
    });

    it('deleting a non-existent session adds nothing to the trash', () => {
      saveChatSession('s1', [user('hi')]);
      deleteChatSession('nope');
      expect(loadTrash()).toHaveLength(0);
      expect(loadChatState().sessions).toHaveLength(1);
    });
  });

  describe('restoreTrash round-trips the session back', () => {
    it('restoreChatSession returns it to chatHistory and empties the entry', () => {
      saveChatSession('s1', [user('你好'), assistant('在的'), user('还在吗')]);
      deleteChatSession('s1');
      expect(loadChatState().sessions).toHaveLength(0);
      expect(loadTrash()).toHaveLength(1);

      const restored = restoreChatSession('s1');
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe('s1');
      expect(restored!.messages).toHaveLength(3);

      const state = loadChatState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe('s1');
      expect(state.sessions[0].messages.map((m) => m.content)).toEqual([
        '你好',
        '在的',
        '还在吗',
      ]);
      expect(loadTrash()).toHaveLength(0);
      expect(localStorage.getItem(TRASH_KEY)).toBe(JSON.stringify([]));
    });

    it('a live session with the same id is overwritten in place, never duplicated', () => {
      const state = {
        activeSessionId: 's1',
        sessions: [session('s1', [user('live copy')])],
      };
      saveTrash([
        {
          sessionId: 's1',
          title: '旧副本',
          messages: [user('trashed copy')],
          deletedAt: Date.now(),
          messageCount: 1,
        },
      ]);

      const result = restoreTrash(state, 's1');
      expect(result).not.toBeNull();
      expect(result!.session.id).toBe('s1');
      expect(result!.session.messages.map((m) => m.content)).toEqual([
        'trashed copy',
      ]);
      // P273: still one row — the trash copy replaces the live entry.
      expect(result!.state.sessions).toHaveLength(1);
      expect(result!.state.sessions[0].messages[0].content).toBe(
        'trashed copy',
      );
      expect(loadTrash()).toHaveLength(0);
    });

    it('returns null for a missing or pruned entry', () => {
      expect(restoreTrash({ activeSessionId: null, sessions: [] }, 'ghost')).toBeNull();
      expect(restoreChatSession('ghost')).toBeNull();
    });
  });

  describe('TTL and capacity', () => {
    it('entries older than 7 days are pruned', () => {
      const now = 10 * TRASH_TTL_MS;
      const entries: TrashEntry[] = [
        {
          sessionId: 'fresh',
          title: '刚删的',
          messages: [user('a')],
          deletedAt: now - TRASH_TTL_MS + 1_000,
          messageCount: 1,
        },
        {
          sessionId: 'expired',
          title: '过期的',
          messages: [user('b')],
          deletedAt: now - TRASH_TTL_MS - 1_000,
          messageCount: 1,
        },
      ];
      expect(pruneTrash(entries, now).map((e) => e.sessionId)).toEqual([
        'fresh',
      ]);
      saveTrash(entries);
      expect(loadTrash(now).map((e) => e.sessionId)).toEqual(['fresh']);
    });

    it('more than 50 sessions evicts the oldest deletions', () => {
      const now = 1_000_000;
      let state: TrashEntry[] = [];
      for (let i = 0; i < TRASH_MAX_SESSIONS; i += 1) {
        state = pushTrash(
          state,
          [session(`old-${i}`, [user('x')])],
          now - i,
        );
      }
      expect(state).toHaveLength(TRASH_MAX_SESSIONS);
      state = pushTrash(state, [session('newest', [user('y')])], now + 1);
      expect(state).toHaveLength(TRASH_MAX_SESSIONS);
      // The oldest entry (old-49, smallest deletedAt) is gone; newest is in.
      expect(state.some((e) => e.sessionId === 'newest')).toBe(true);
      expect(state.some((e) => e.sessionId === 'old-49')).toBe(false);
      expect(state[0].sessionId).toBe('newest');
    });

    it('a re-delete of the same session replaces its older trash entry', () => {
      const now = 5_000;
      let state = pushTrash([], [session('s1', [user('first delete')])], now);
      state = pushTrash(state, [session('s1', [user('second delete')])], now + 1);
      expect(state).toHaveLength(1);
      expect(state[0].deletedAt).toBe(now + 1);
      expect(state[0].messages[0].content).toBe('second delete');
    });
  });

  describe('clearAllChatSessions moves every session into the trash', () => {
    it('the whole wiped list lands in the bin in one go', () => {
      saveChatSession('s1', [user('第一条')]);
      saveChatSession('s2', [user('第二条'), assistant('回复')]);
      saveChatSession('s3', [user('第三条')]);

      clearAllChatSessions();

      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });
      const trash = loadTrash();
      expect(trash).toHaveLength(3);
      expect(new Set(trash.map((e) => e.sessionId))).toEqual(
        new Set(['s1', 's2', 's3']),
      );
      expect(trash.find((e) => e.sessionId === 's2')!.messageCount).toBe(2);
    });

    it('a restored cleared session survives a reload of the store', () => {
      saveChatSession('s1', [user('持久化')]);
      clearAllChatSessions();
      const restored = restoreChatSession('s1');
      expect(restored).not.toBeNull();
      const again = loadChatState();
      expect(again.sessions[0].messages.map((m) => m.content)).toEqual([
        '持久化',
      ]);
    });
  });

  describe('storage failures never escape', () => {
    it('saveTrash does not throw when localStorage.setItem throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
        removeItem: () => {},
        clear: () => {},
      });
      expect(() =>
        saveTrash([
          {
            sessionId: 's1',
            title: 't',
            messages: [],
            deletedAt: 1,
            messageCount: 0,
          },
        ]),
      ).not.toThrow();
      expect(() => clearTrash()).not.toThrow();
    });

    it('loadTrash returns [] when localStorage throws or holds garbage', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      });
      expect(loadTrash()).toEqual([]);

      const store = stubStorage();
      store.set(TRASH_KEY, '{not json');
      expect(loadTrash()).toEqual([]);
      store.set(TRASH_KEY, JSON.stringify({ sessions: 'wrong shape' }));
      expect(loadTrash()).toEqual([]);
      store.set(
        TRASH_KEY,
        JSON.stringify([
          { sessionId: '', title: 'no id', messages: [], deletedAt: 1 },
          {
            sessionId: 'ok',
            title: '好的',
            messages: 'oops',
            deletedAt: Date.now(),
          },
        ]),
      );
      const ok = loadTrash();
      expect(ok).toHaveLength(1);
      expect(ok[0].sessionId).toBe('ok');
      expect(ok[0].messages).toEqual([]);
    });

    it('a quota-blocked trash write never breaks the delete itself', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (k === TRASH_KEY) throw new Error('quota');
          store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
      saveChatSession('s1', [user('hi')]);
      expect(() => deleteChatSession('s1')).not.toThrow();
      expect(loadChatState().sessions).toHaveLength(0);
    });
  });

  describe('the single-delete undo toast', () => {
    it('arms the same window with 「已移到回收站」 and 撤销', () => {
      const ctl = createClearAllUndo(() => {});
      ctl.confirm({
        takeSnapshot: loadChatState,
        message: '已移到回收站',
        wipe: () => {},
        restore: () => {},
      });
      expect(ctl.current()).toEqual({
        seq: 1,
        message: '已移到回收站',
        actionLabel: '撤销',
      });
      ctl.destroy();
    });

    it('undo pulls the trashed entry back through restoreChatSession', () => {
      saveChatSession('s1', [user('误删')]);
      deleteChatSession('s1');
      expect(loadTrash()).toHaveLength(1);

      const session = restoreChatSession('s1');
      expect(session).not.toBeNull();
      expect(loadChatState().sessions[0].id).toBe('s1');
      expect(loadTrash()).toHaveLength(0);
    });
  });

  describe('sidebar wiring', () => {
    it('the 回收站 row renders only when something exists to manage', () => {
      expect(shouldShowTrashEntry(0, 0)).toBe(false);
      expect(shouldShowTrashEntry(0, 2)).toBe(true);
      expect(shouldShowTrashEntry(5, 0)).toBe(true);
      expect(shouldShowTrashEntry(3, 4)).toBe(true);
    });

    it('Sidebar shows the count-labelled row above the eviction notice', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain('shouldShowTrashEntry(');
      expect(sidebar).toContain('回收站（{trashEntries.length}）');
      expect(sidebar).toContain('recent-chat-trash');
      expect(sidebar).toContain('<TrashSheet');
      const trashRow = sidebar.indexOf('recent-chat-trash');
      const eviction = sidebar.indexOf('recent-chat-eviction');
      expect(trashRow).toBeGreaterThan(-1);
      expect(eviction).toBeGreaterThan(trashRow);
    });

    it('the sheet lists restorable rows and confirms 清空回收站 in-app', () => {
      const sheet = read('components/TrashSheet.tsx');
      expect(sheet).toContain('回收站保留 7 天，之后自动清除');
      expect(sheet).toContain('恢复');
      expect(sheet).toContain('恢复对话：');
      expect(sheet).toContain('清空回收站');
      expect(sheet).toContain('formatRelativeTime');
      // The second confirm reuses the shared dialog (confirm-overlay/panel).
      expect(sheet).toContain('<ConfirmDialog');
      expect(sheet).not.toContain('window.confirm');
    });

    it('App wires the delete toast, the trash state and the restore handlers', () => {
      const app = read('App.tsx');
      expect(app).toContain('已移到回收站');
      expect(app).toContain('trashUndoCtl.confirm(');
      expect(app).toContain('restoreChatSession(');
      expect(app).toContain('trashEntries={trashEntries}');
      expect(app).toContain('onRestoreTrash={handleRestoreTrash}');
      expect(app).toContain('onClearTrash={handleClearTrash}');
      expect(app).toContain('setTrashEntries(loadTrash())');
      expect(app).toContain('clearTrash()');
    });
  });
});
