/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeChatFromState, watchChatStorage } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P156 — cross-tab session sync. vitest runs in node (no DOM), so `window`
 * is replaced with a bare EventTarget and `storage` events are plain Events
 * carrying a `key` property (StorageEvent does not exist here). The returned
 * unsubscribe stands in for the effect cleanup on unmount; source guards
 * lock in the App wiring, as in delete-session.test.ts / clear-all-chats.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const STORAGE_KEY = 'datingAgent.chatHistory';

const storageEvent = (key: string | null): Event => {
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: key });
  return event;
};

describe('P156 · cross-tab session sync', () => {
  let events: EventTarget;

  beforeEach(() => {
    events = new EventTarget();
    vi.stubGlobal('window', events);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fires the callback for the chat-history key', () => {
    const onChange = vi.fn();
    watchChatStorage(onChange);
    events.dispatchEvent(storageEvent(STORAGE_KEY));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores storage events for unrelated keys', () => {
    const onChange = vi.fn();
    watchChatStorage(onChange);
    events.dispatchEvent(storageEvent('datingagent.replyLanguage'));
    events.dispatchEvent(storageEvent('unrelated.key'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats key === null (a localStorage.clear()) as a change', () => {
    const onChange = vi.fn();
    watchChatStorage(onChange);
    events.dispatchEvent(storageEvent(null));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops firing after unsubscribe and removes the listener', () => {
    const removeSpy = vi.spyOn(events, 'removeEventListener');
    const onChange = vi.fn();
    const stop = watchChatStorage(onChange);

    stop();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));

    events.dispatchEvent(storageEvent(STORAGE_KEY));
    events.dispatchEvent(storageEvent(null));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is a safe no-op when window is absent (SSR)', () => {
    vi.stubGlobal('window', undefined);
    const onChange = vi.fn();
    const stop = watchChatStorage(onChange);
    expect(() => stop()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('activeChatFromState', () => {
    const msg = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });
    const sessions = [
      { id: 's1', title: '第一条', updatedAt: 2, messages: [msg('你好')] },
      { id: 's2', title: '第二条', updatedAt: 1, messages: [msg('在吗')] },
    ];

    it('returns the active session conversation', () => {
      expect(activeChatFromState({ activeSessionId: 's2', sessions })).toEqual({
        sessionId: 's2',
        messages: sessions[1].messages,
      });
    });

    it('falls back to a clean empty chat when the active session is gone', () => {
      // Deleted in the other tab: dangling id, or cleared to null.
      expect(activeChatFromState({ activeSessionId: 'deleted-id', sessions })).toEqual({
        sessionId: null,
        messages: [],
      });
      expect(activeChatFromState({ activeSessionId: null, sessions: [] })).toEqual({
        sessionId: null,
        messages: [],
      });
    });
  });

  describe('App wiring (source guards)', () => {
    it('subscribes on mount, reloads sidebar + conversation, cleans up on unmount', () => {
      const app = read('App.tsx');
      const watcher = app.indexOf('watchChatStorage(');
      expect(watcher).toBeGreaterThan(-1);
      const effect = app.slice(app.lastIndexOf('useEffect(', watcher), watcher + 600);
      expect(effect).toContain('loadChatState()');
      expect(effect).toContain('setRecentSessions(getRecentSessions())');
      expect(effect).toContain('activeChatFromState(');
      expect(effect).toContain('setSessionId(next.sessionId)');
      expect(effect).toContain('setMessages(next.messages)');
      // The watcher's return value is the effect cleanup (removeEventListener).
      expect(effect).toMatch(/useEffect\(\s*\(\)\s*=>/);
      expect(app.slice(watcher)).toContain('[]');
    });

    it('skips the refresh while a reply is streaming rather than aborting', () => {
      const app = read('App.tsx');
      expect(app).toContain('const loadingRef = useRef(loading)');
      const watcher = app.indexOf('watchChatStorage(');
      const body = app.slice(watcher, watcher + 600);
      expect(body).toContain('if (loadingRef.current) return;');
      // No abort inside the cross-tab refresh path.
      expect(body).not.toContain('abortRef.current?.abort()');
    });
  });
});
