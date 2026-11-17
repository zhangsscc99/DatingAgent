/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadChatState,
  saveChatSession,
  watchChatStorage,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P250 — the save effect and the cross-tab watch used to feed each other:
 * each persist bounced back as a storage event whose handler swapped
 * `messages` for a fresh array, which re-fired the save effect, which wrote
 * again — ~120 setItem/s on an idle page, and a clear-all that lost the
 * race to its own loop. These tests pin the three circuit breakers:
 *   1. an own-write echo (newValue identical to our last persist) is dropped;
 *   2. a foreign write carrying different bytes still syncs (P156 contract);
 *   3. a save identical to the stored state never reaches setItem at all.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';

const msg = (id: string, content: string, createdAt = 1_000): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt,
});

function stubStorage() {
  const store = new Map<string, string>();
  let setCount = 0;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      setCount += 1;
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
  return { store, writes: () => setCount };
}

const storageEvent = (key: string | null, newValue?: string): Event => {
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: key });
  if (newValue !== undefined) {
    Object.defineProperty(event, 'newValue', { value: newValue });
  }
  return event;
};

describe('P250 · save ↔ watch write loop', () => {
  let events: EventTarget;

  beforeEach(() => {
    events = new EventTarget();
    vi.stubGlobal('window', events);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({} as Response)),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('a saveChatSession causes zero extra watch firings — own-write echoes are dropped', () => {
    const { store } = stubStorage();
    const onChange = vi.fn();
    watchChatStorage(onChange);

    // Five saves, each followed by the storage event a same-window dispatch
    // would produce (the non-standard echo seen on the instrumented browser:
    // newValue is byte-identical to what we just wrote).
    for (let i = 0; i < 5; i += 1) {
      saveChatSession('s1', [msg(`u${i}`, `消息 ${i}`)]);
      const written = store.get(STORAGE_KEY);
      expect(written).toBeTruthy();
      events.dispatchEvent(storageEvent(STORAGE_KEY, written!));
    }

    expect(onChange).not.toHaveBeenCalled();
    expect(loadChatState().sessions).toHaveLength(1);
  });

  it('still syncs a write that came from another tab (P156 contract)', () => {
    const { store } = stubStorage();
    saveChatSession('s1', [msg('u1', '本会话')]);
    const onChange = vi.fn();
    watchChatStorage(onChange);

    const foreign = JSON.stringify({
      activeSessionId: 's-foreign',
      sessions: [
        {
          id: 's-foreign',
          title: '另一标签',
          updatedAt: 999,
          messages: [{ id: 'u9', role: 'user', content: '别的标签写的' }],
        },
      ],
    });
    // A foreign write bypasses persistState — lastPersistedJson still holds
    // our own bytes — so its different newValue must reach the listener.
    store.set(STORAGE_KEY, foreign);
    events.dispatchEvent(storageEvent(STORAGE_KEY, foreign));
    expect(onChange).toHaveBeenCalledTimes(1);

    // A foreign wipe (different bytes again) and a full clear() still fire.
    const wiped = JSON.stringify({ activeSessionId: null, sessions: [] });
    store.set(STORAGE_KEY, wiped);
    events.dispatchEvent(storageEvent(STORAGE_KEY, wiped));
    events.dispatchEvent(storageEvent(null));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('re-saving identical content never reaches localStorage.setItem', () => {
    const { writes } = stubStorage();
    const messages: ChatMessage[] = [
      msg('u1', '她说明天要加班'),
      { id: 'a1', role: 'assistant', content: '早点休息', createdAt: 1_001 },
    ];

    saveChatSession('s1', messages);
    const afterFirst = writes();
    expect(afterFirst).toBeGreaterThan(0);

    // The save effect re-firing on an unchanged conversation — the loop's
    // steady state — must be a pure no-op at the storage layer.
    saveChatSession('s1', messages);
    saveChatSession('s1', [...messages]);
    saveChatSession('s1', messages.map((m) => ({ ...m })));
    expect(writes()).toBe(afterFirst);

    // Changed content still writes — the dedup is not a write-blocker.
    saveChatSession('s1', [...messages, msg('u2', '新一句', 1_002)]);
    expect(writes()).toBeGreaterThan(afterFirst);
  });
});
