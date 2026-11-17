/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  loadChatState,
  normalizeReplyMeta,
  normalizeStoredSessions,
  saveChatSession,
  serializeMessages,
} from '../src/lib/chatStorage';

/**
 * P243 — the reply meta line (tool name + 「约 N 秒」) used to live only on
 * the in-memory message: serializeMessages dropped it on write and
 * normalizeStoredSessions on read, so a hard reload removed the whole
 * `.reply-meta` row while the bubble stayed. The fix carries a well-formed
 * `meta` ({tool?, latencyMs?, tokens?}) through the storage round trip and
 * drops malformed metas silently — never throwing, never rendering junk.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';

const user = (content: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content,
});

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content: '可以先接住她的表情包，再顺着约咖啡。',
  createdAt: 1,
  ...over,
});

const GOOD_META = { tool: 'coach_conversation', latencyMs: 6300, tokens: 120 };

/** The same shape a hard reload produces: serialize → JSON → normalise. */
const storedSession = (messages: unknown[]) => ({
  id: 's1',
  title: '对话',
  updatedAt: 1,
  messages,
});

let store: Map<string, string>;

describe('P243 · reply meta survives the storage round trip', () => {
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('serializeMessages keeps a well-formed meta verbatim', () => {
    const [out] = serializeMessages([assistant({ meta: { ...GOOD_META } })]);
    expect(out.meta).toEqual(GOOD_META);
  });

  it('a partial meta (no tool) also survives', () => {
    const [out] = serializeMessages([
      assistant({ meta: { latencyMs: 3500, tokens: 55 } }),
    ]);
    expect(out.meta).toEqual({ latencyMs: 3500, tokens: 55 });
  });

  it('saveChatSession → loadChatState preserves {tool, latencyMs, tokens}', () => {
    saveChatSession('s1', [
      user('她昨天没回我消息'),
      assistant({ meta: { ...GOOD_META } }),
    ]);
    const state = loadChatState();
    expect(state.sessions).toHaveLength(1);
    const restored = state.sessions[0].messages[1];
    expect(restored.meta).toEqual(GOOD_META);
  });

  it('a message without meta stays without meta in both directions', () => {
    const [out] = serializeMessages([assistant()]);
    expect('meta' in out).toBe(false);
    saveChatSession('s1', [user('在吗'), assistant()]);
    const restored = loadChatState().sessions[0].messages[1];
    expect('meta' in restored).toBe(false);
  });

  it('drops a malformed meta on write — junk never reaches storage', () => {
    for (const junk of [
      'oops',
      42,
      null,
      [],
      { latencyMs: Number.NaN },
      { tool: '   ' },
      { tokens: -1 },
      { tokens: 1e9 },
      { tokens: Infinity },
    ]) {
      const [out] = serializeMessages([
        assistant({ meta: junk as unknown as ChatMessage['meta'] }),
      ]);
      expect('meta' in out, JSON.stringify(junk)).toBe(false);
    }
  });

  it('drops a malformed meta on read inside loadChatState', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        activeSessionId: 's1',
        sessions: [
          storedSession([
            user('在吗'),
            { ...assistant(), meta: 'oops' },
            { ...assistant({ id: 'a2' }), meta: { tool: '', latencyMs: null } },
            {
              ...assistant({ id: 'a3' }),
              meta: { tool: 'get_relationship_advice', latencyMs: 4700, tokens: 96 },
            },
          ]),
        ],
      }),
    );
    const messages = loadChatState().sessions[0].messages;
    expect('meta' in messages[1]).toBe(false);
    expect('meta' in messages[2]).toBe(false);
    expect(messages[3].meta).toEqual({
      tool: 'get_relationship_advice',
      latencyMs: 4700,
      tokens: 96,
    });
  });

  it('keeps the good fields of a partially-broken meta, drops only the junk', () => {
    const [s] = normalizeStoredSessions([
      storedSession([
        { ...assistant(), meta: { tool: 'plan_date', latencyMs: 'NaN-ish' } },
      ]),
    ]);
    expect(s.messages[0].meta).toEqual({ tool: 'plan_date' });
  });

  it('strips unknown meta fields and absurd token counts', () => {
    const [s] = normalizeStoredSessions([
      storedSession([
        {
          ...assistant(),
          meta: { tool: 'x', tokens: 1_000_001, extra: 'junk' },
        },
      ]),
    ]);
    expect(s.messages[0].meta).toEqual({ tool: 'x' });
  });

  it('normalizeReplyMeta gates every malformed shape without throwing', () => {
    expect(() => normalizeReplyMeta('oops')).not.toThrow();
    expect(normalizeReplyMeta('oops')).toBeUndefined();
    expect(normalizeReplyMeta(null)).toBeUndefined();
    expect(normalizeReplyMeta(undefined)).toBeUndefined();
    expect(normalizeReplyMeta(42)).toBeUndefined();
    expect(normalizeReplyMeta([])).toBeUndefined();
    expect(normalizeReplyMeta({})).toBeUndefined();
    expect(normalizeReplyMeta({ latencyMs: Number.NaN })).toBeUndefined();
    expect(normalizeReplyMeta({ latencyMs: -5 })).toBeUndefined();
    expect(normalizeReplyMeta({ latencyMs: 0 })).toEqual({ latencyMs: 0 });
    expect(normalizeReplyMeta({ tool: '   ' })).toBeUndefined();
    expect(normalizeReplyMeta({ tokens: Infinity })).toBeUndefined();
    expect(normalizeReplyMeta({ tokens: 1_000_001 })).toBeUndefined();
    expect(normalizeReplyMeta({ tokens: 999_999 })).toEqual({
      tokens: 999_999,
    });
    expect(normalizeReplyMeta({ ...GOOD_META })).toEqual(GOOD_META);
  });

  it('a streamed or blank assistant bubble still never reaches storage', () => {
    const streaming = assistant({ id: 'a-stream', streaming: true, meta: { ...GOOD_META } });
    const blank = assistant({ id: 'a-blank', content: '   ', meta: { ...GOOD_META } });
    const out = serializeMessages([user('hi'), streaming, blank]);
    expect(out.map((m) => m.id)).toEqual(['u1']);
  });
});
