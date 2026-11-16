/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import { loadChatState, normalizeStoredSessions } from '../src/lib/chatStorage';
import type { StoredChatSession } from '../src/lib/chatStorage';

/**
 * P158 — session entry self-heal. A single corrupted record in localStorage
 * used to white-screen the page at `session.messages.map`; normalization must
 * drop the broken entries, repair recoverable fields, and never throw.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';

const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content });
const assistant = (content = 'reply'): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content,
});

const sess = (id: string, updatedAt: number, title = id): StoredChatSession => ({
  id,
  title,
  updatedAt,
  messages: [user('hi'), assistant()],
});

let store: Map<string, string>;

describe('P158 · stored session normalization', () => {
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('drops broken sessions and keeps the good one without throwing', () => {
    const good = sess('good', 1);
    const raw: unknown[] = [
      { id: 'bad-messages', title: 'x', updatedAt: 1, messages: 'oops' },
      { id: 'bad-title', updatedAt: 2, messages: [] },
      { title: 'no-id', updatedAt: 3, messages: [] },
      'not-an-object',
      null,
      { id: 'bad-messages', title: 'dup', updatedAt: 4, messages: [] },
    ];
    const result = normalizeStoredSessions(raw);
    expect(result.map((s) => s.id)).toEqual(['bad-messages', 'bad-title']);
    expect(result[0].messages).toEqual([]);
    expect(result[1].title).toBe('未命名对话');
    expect(() => normalizeStoredSessions([...raw, good])).not.toThrow();
    expect(
      normalizeStoredSessions([
        { id: 'broken', messages: 'oops' },
        { ...good },
      ]).map((s) => s.id),
    ).toEqual(['broken', 'good']);
  });

  it('falls back title for whitespace-only and updatedAt for missing/invalid', () => {
    const [a, b, c] = normalizeStoredSessions([
      { id: 'a', title: '   ', updatedAt: 'soon', messages: [] },
      { id: 'b', title: 'ok' },
      { id: 'c', title: 42, updatedAt: Infinity, messages: [] },
    ]);
    expect(a.title).toBe('未命名对话');
    expect(a.updatedAt).toBe(0);
    expect(b.title).toBe('ok');
    expect(b.updatedAt).toBe(0);
    expect(c.title).toBe('未命名对话');
    expect(c.updatedAt).toBe(0);
  });

  it('returns [] for a string, null, or object input', () => {
    expect(normalizeStoredSessions('nope')).toEqual([]);
    expect(normalizeStoredSessions(null)).toEqual([]);
    expect(normalizeStoredSessions(undefined)).toEqual([]);
    expect(normalizeStoredSessions({ sessions: [] })).toEqual([]);
    expect(normalizeStoredSessions(42)).toEqual([]);
  });

  it('collapses duplicate ids keeping the first occurrence', () => {
    const result = normalizeStoredSessions([
      { id: 's1', title: 'first', updatedAt: 1, messages: [] },
      { id: 's2', title: 'other', updatedAt: 2, messages: [] },
      { id: 's1', title: 'second', updatedAt: 3, messages: [] },
    ]);
    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result[0].title).toBe('first');
    expect(result[0].updatedAt).toBe(1);
  });

  it('drops non-object messages but keeps the valid ones', () => {
    const [s] = normalizeStoredSessions([
      {
        id: 's1',
        title: 't',
        updatedAt: 1,
        messages: [user('keep'), 'junk', null, 7, { id: 'm2', role: 'assistant', content: 'k' }],
      },
    ]);
    expect(s.messages).toHaveLength(2);
  });

  it('keeps customTitle only when it is exactly true', () => {
    const [a, b, c] = normalizeStoredSessions([
      { id: 'a', title: 't', updatedAt: 1, messages: [], customTitle: true },
      { id: 'b', title: 't', updatedAt: 1, messages: [], customTitle: 'yes' },
      { id: 'c', title: 't', updatedAt: 1, messages: [] },
    ]);
    expect(a.customTitle).toBe(true);
    expect('customTitle' in b).toBe(false);
    expect('customTitle' in c).toBe(false);
  });

  it('does not mutate its input', () => {
    const entry = { id: 's1', title: 't', updatedAt: 1, messages: [user('hi'), 'junk'] };
    const raw = [entry];
    normalizeStoredSessions(raw);
    expect(entry.messages).toHaveLength(2);
    expect(raw).toHaveLength(1);
  });

  it('round-trips good data through loadChatState unchanged', () => {
    const stored = {
      activeSessionId: 's1',
      sessions: [
        sess('s1', 2, '标题一'),
        { ...sess('s2', 1, '标题二'), customTitle: true },
      ],
    };
    store.set(STORAGE_KEY, JSON.stringify(stored));
    const state = loadChatState();
    expect(state).toEqual(stored);
    expect(state.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('heals a corrupted record inside loadChatState', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        activeSessionId: 'bad',
        sessions: [{ id: 'bad', messages: 'oops' }, sess('good', 1)],
      }),
    );
    const state = loadChatState();
    expect(state.activeSessionId).toBe('bad');
    expect(state.sessions.map((s) => s.id)).toEqual(['bad', 'good']);
    expect(state.sessions[0].messages).toEqual([]);
    expect(state.sessions[0].title).toBe('未命名对话');
    expect(state.sessions[0].updatedAt).toBe(0);
  });

  it.each(['"null"', 'null', '"42"', '42', '"[1,2]"', '[1,2]', '"hello"', 'true'])(
    'a non-object stored payload %s yields the default state without throwing',
    (payload) => {
      store.set(STORAGE_KEY, payload);
      let state: ReturnType<typeof loadChatState> | undefined;
      expect(() => {
        state = loadChatState();
      }).not.toThrow();
      expect(state).toEqual({ activeSessionId: null, sessions: [] });
    },
  );

  it('a non-string activeSessionId becomes null', () => {
    store.set(STORAGE_KEY, JSON.stringify({ activeSessionId: 7, sessions: [] }));
    expect(loadChatState().activeSessionId).toBeNull();
  });
});
