/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLEAR_ALL_UNDO_ACTION_LABEL,
  CLEAR_ALL_UNDO_MESSAGE,
  CLEAR_ALL_UNDO_MS,
  createClearAllUndo,
  type ClearAllUndoToastState,
} from '../src/lib/clearAllUndo';
import {
  clearAllChatSessions,
  loadChatState,
  renameChatSession,
  restoreChatState,
  saveChatSession,
  setActiveSessionId,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P247 — 清空全部 used to be silent and final: confirm → everything gone,
 * no toast, no way back. The fix arms a 6 s undo window — the wiped state
 * is snapshotted first and 撤销 writes it back verbatim; only the timeout
 * or a manual close drops it for good. Behavioural blocks drive the pure
 * controller against a stubbed localStorage (fake timers for the window);
 * source guards lock the App/UndoToast/Sidebar wiring.
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
}

describe('P247 · clear-all undo toast', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({} as Response)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('toast contract', () => {
    it('confirm shows 「已清空全部对话」 with a 「撤销」 action', () => {
      const ctl = createClearAllUndo(() => {});
      ctl.confirm({
        takeSnapshot: loadChatState,
        wipe: () => {},
        restore: () => {},
      });
      const toast = ctl.current();
      expect(toast).not.toBeNull();
      expect(toast!.message).toBe('已清空全部对话');
      expect(toast!.actionLabel).toBe('撤销');
      expect(CLEAR_ALL_UNDO_MESSAGE).toContain('已清空全部对话');
      expect(CLEAR_ALL_UNDO_ACTION_LABEL).toBe('撤销');
      ctl.destroy();
    });

    it('App renders the toast through UndoToast and routes both 清空全部 entries to it', () => {
      const app = read('App.tsx');
      expect(app).toContain('createClearAllUndo');
      expect(app).toContain('<UndoToast');
      expect(app).toContain('onAction={clearAllUndoCtl.undo}');
      expect(app).toContain('onDismiss={clearAllUndoCtl.dismiss}');
      // Both destructive entries still funnel through the one handler.
      expect(app).toContain('onClearAllChats={requestClearAllChats}');
      expect(app).toContain('onClearAll={requestClearAllChats}');
      const handler = app.slice(app.indexOf('const handleClearAllChats'));
      expect(handler).toContain('clearAllUndoCtl.confirm(');
      expect(handler).toContain('takeSnapshot: loadChatState');
      expect(handler).toContain('clearAllChatSessions()');
      expect(handler).toContain('restore: restoreClearedChats');
      const restore = app.slice(app.indexOf('const restoreClearedChats'));
      expect(restore).toContain('restoreChatState(snapshot)');
      // Single-session delete never reaches the undo controller.
      const deleter = app.slice(
        app.indexOf('const performDeleteChat'),
        app.indexOf('const requestClearAllChats'),
      );
      expect(deleter).not.toContain('clearAllUndoCtl');
    });

    it('UndoToast carries the message, the undo action and a close affordance', () => {
      const toast = read('components/UndoToast.tsx');
      expect(toast).toContain('role="status"');
      expect(toast).toContain('{actionLabel}');
      expect(toast).toContain('onAction');
      expect(toast).toContain('aria-label="关闭"');
    });
  });

  describe('undo restores the snapshot verbatim', () => {
    it('restoreChatState writes back ids, titles, message counts and the active pointer', () => {
      saveChatSession('s1', [user('第一条'), assistant('回复一')]);
      saveChatSession('s2', [user('第二条'), assistant('回复二'), user('第三条')]);
      renameChatSession('s1', '周末计划');
      setActiveSessionId('s2');
      const before = loadChatState();
      expect(before.sessions).toHaveLength(2);

      const ctl = createClearAllUndo(() => {});
      ctl.confirm({
        takeSnapshot: loadChatState,
        wipe: clearAllChatSessions,
        restore: restoreChatState,
      });
      expect(loadChatState()).toEqual({ activeSessionId: null, sessions: [] });

      ctl.undo();
      const after = loadChatState();
      expect(after).toEqual(before);
      expect(after.sessions.map((s) => s.id)).toEqual(
        before.sessions.map((s) => s.id),
      );
      expect(after.sessions.map((s) => s.title)).toEqual(
        before.sessions.map((s) => s.title),
      );
      expect(after.sessions.map((s) => s.messages.length)).toEqual(
        before.sessions.map((s) => s.messages.length),
      );
      expect(after.activeSessionId).toBe('s2');
      ctl.destroy();
    });

    it('the P250 tombstone still refuses stale saves after the restore', () => {
      const stale = [user('旧消息', 1_000)];
      saveChatSession('s1', stale);
      const snapshot = loadChatState();
      clearAllChatSessions();
      restoreChatState(snapshot);
      // A pre-clear in-memory copy still cannot write itself back.
      saveChatSession('s1', stale);
      const state = loadChatState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].messages).toHaveLength(1);
    });
  });

  describe('the 6 s window', () => {
    it('expires the snapshot and auto-hides the toast — a late undo is a no-op', () => {
      vi.useFakeTimers();
      saveChatSession('s1', [user('hi')]);
      const restore = vi.fn();
      const ctl = createClearAllUndo(() => {});
      ctl.confirm({ takeSnapshot: loadChatState, wipe: clearAllChatSessions, restore });
      expect(ctl.current()).not.toBeNull();

      vi.advanceTimersByTime(CLEAR_ALL_UNDO_MS);
      expect(ctl.current()).toBeNull();

      ctl.undo();
      expect(restore).not.toHaveBeenCalled();
      expect(loadChatState().sessions).toHaveLength(0);
      ctl.destroy();
    });

    it('keeps the toast armed right up to the deadline', () => {
      vi.useFakeTimers();
      const restore = vi.fn();
      const ctl = createClearAllUndo(() => {});
      ctl.confirm({ takeSnapshot: loadChatState, wipe: () => {}, restore });
      vi.advanceTimersByTime(CLEAR_ALL_UNDO_MS - 1);
      expect(ctl.current()).not.toBeNull();
      ctl.undo();
      expect(restore).toHaveBeenCalledTimes(1);
      expect(ctl.current()).toBeNull();
      ctl.destroy();
    });
  });

  describe('edge cases', () => {
    it('dismissing the toast drops the snapshot — it can never resurrect', () => {
      vi.useFakeTimers();
      saveChatSession('s1', [user('hi')]);
      const restore = vi.fn();
      const events: (ClearAllUndoToastState | null)[] = [];
      const ctl = createClearAllUndo((t) => events.push(t));
      ctl.confirm({ takeSnapshot: loadChatState, wipe: clearAllChatSessions, restore });

      ctl.dismiss();
      expect(ctl.current()).toBeNull();
      ctl.undo();
      expect(restore).not.toHaveBeenCalled();
      expect(loadChatState().sessions).toHaveLength(0);
      // And the pending timer was cancelled — nothing fires later either.
      vi.advanceTimersByTime(CLEAR_ALL_UNDO_MS * 2);
      expect(events.filter((t) => t !== null)).toHaveLength(1);
      ctl.destroy();
    });

    it('undo only fires once', () => {
      const restore = vi.fn();
      const ctl = createClearAllUndo(() => {});
      ctl.confirm({ takeSnapshot: loadChatState, wipe: () => {}, restore });
      ctl.undo();
      ctl.undo();
      expect(restore).toHaveBeenCalledTimes(1);
      ctl.destroy();
    });

    it('a second clear-all replaces the pending undo — no double-restore, no stale timer', () => {
      vi.useFakeTimers();
      saveChatSession('s1', [user('第一批')]);
      const firstRestore = vi.fn();
      const secondRestore = vi.fn();
      const ctl = createClearAllUndo(() => {});

      ctl.confirm({
        takeSnapshot: loadChatState,
        wipe: clearAllChatSessions,
        restore: firstRestore,
      });
      // A genuinely new conversation starts after the first wipe…
      saveChatSession('s2', [user('第二批', Date.now() + 1_000)]);
      // …and is cleared too, before the first window ends.
      ctl.confirm({
        takeSnapshot: loadChatState,
        wipe: clearAllChatSessions,
        restore: secondRestore,
      });
      expect(ctl.current()!.seq).toBe(2);

      ctl.undo();
      expect(firstRestore).not.toHaveBeenCalled();
      expect(secondRestore).toHaveBeenCalledTimes(1);
      expect(secondRestore.mock.calls[0][0].sessions.map((s: { id: string }) => s.id)).toEqual(['s2']);

      // No stale first timer survives to hide or resurrect anything later.
      vi.advanceTimersByTime(CLEAR_ALL_UNDO_MS * 2);
      expect(ctl.current()).toBeNull();
      ctl.undo();
      expect(secondRestore).toHaveBeenCalledTimes(1);
      ctl.destroy();
    });

    it('unmount teardown cancels the window without notifying', () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const restore = vi.fn();
      const ctl = createClearAllUndo(onChange);
      ctl.confirm({ takeSnapshot: loadChatState, wipe: () => {}, restore });
      ctl.destroy();
      vi.advanceTimersByTime(CLEAR_ALL_UNDO_MS * 2);
      ctl.undo();
      expect(restore).not.toHaveBeenCalled();
      // destroy() itself never emits — React is already gone.
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
