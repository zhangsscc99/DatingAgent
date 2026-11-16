/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSseDataLine } from '../src/lib/sse';
import { foldReplyDraft } from '../src/lib/streamDraft';
import {
  EMPTY_CHAT_SEARCH,
  resetSearchOnSessionChange,
  retryableMessageId,
} from '../src/lib/chatSearchState';
import type { AgentEvent, ChatMessage } from '../src/types';

/**
 * P189 — streamed reply tokens. The upstream deltas used to be invisible:
 * the bubble sat on a placeholder for 12–35 s then jumped to the full text.
 * foldReplyDraft is the pure reducer the App read loop folds every content
 * event through — deltas accumulate, a later `message` still overwrites
 * with the authoritative text, and terminal/other events leave the draft
 * alone. App wiring is guarded at source level (no DOM harness exists).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const delta = (content: string): AgentEvent => ({ type: 'delta', data: { content } });
const message = (content: string): AgentEvent => ({
  type: 'message',
  data: { content, role: 'assistant' },
});

/** Mirror of the App read loop: fold events, keep the latest non-null draft. */
function runEvents(lines: string[]): { draft: string; done: boolean } {
  let draft = '';
  let done = false;
  for (const line of lines) {
    const event = parseSseDataLine(line);
    if (event === null) continue;
    const folded = foldReplyDraft(draft, event);
    if (folded !== null) draft = folded;
    if (event.type === 'done' || event.type === 'error') done = true;
  }
  return { draft, done };
}

describe('P189 · delta frames parse', () => {
  it('parseSseDataLine accepts a delta event', () => {
    const event = parseSseDataLine('data: {"type":"delta","data":{"content":"x"}}');
    expect(event).not.toBeNull();
    expect(event).toEqual({ type: 'delta', data: { content: 'x' } });
  });
});

describe('P189 · foldReplyDraft', () => {
  it('accumulates consecutive deltas into the draft', () => {
    let draft = '';
    for (const piece of ['你好', '，', '世界']) {
      draft = foldReplyDraft(draft, delta(piece)) ?? draft;
    }
    expect(draft).toBe('你好，世界');
  });

  it('a later message overwrites the draft with the authoritative text', () => {
    let draft = '';
    draft = foldReplyDraft(draft, delta('你好')) ?? draft;
    draft = foldReplyDraft(draft, delta('，世界')) ?? draft;
    expect(draft).toBe('你好，世界');

    draft = foldReplyDraft(draft, message('你好，世界。')) ?? draft;
    expect(draft).toBe('你好，世界。');
  });

  it('non-content events return null so the draft is untouched', () => {
    const mid = '半截回复';
    for (const event of [
      { type: 'thinking', data: { message: '正在思考…' } },
      { type: 'tool_start', data: { name: 'plan_date' } },
      { type: 'tool_end', data: { name: 'plan_date', result: {} } },
      { type: 'done', data: { sessionId: 's1', tokens: 7 } },
      { type: 'error', data: { message: 'boom' } },
    ] satisfies AgentEvent[]) {
      expect(foldReplyDraft(mid, event)).toBeNull();
    }
  });

  it('malformed content payloads return null instead of poisoning the draft', () => {
    for (const event of [
      { type: 'delta', data: {} },
      { type: 'delta', data: { content: 42 } },
      { type: 'delta', data: null },
      { type: 'message', data: { content: undefined } },
      { type: 'message', data: 'text' },
    ] as AgentEvent[]) {
      expect(foldReplyDraft('已累积', event)).toBeNull();
    }
  });
});

describe('P189 · end-to-end fold over raw SSE lines', () => {
  it('deltas grow the draft, message pins it, done closes the turn', () => {
    const { draft, done } = runEvents([
      'data: {"type":"thinking","data":{"message":"正在思考…"}}',
      'data: {"type":"delta","data":{"content":"我是 "}}',
      'data: {"type":"delta","data":{"content":"Dating"}}',
      'data: {"type":"delta","data":{"content":"Agent"}}',
      'data: {"type":"message","data":{"content":"我是 DatingAgent。","role":"assistant"}}',
      'data: {"type":"done","data":{"sessionId":"s1","tokens":9}}',
    ]);
    expect(draft).toBe('我是 DatingAgent。');
    expect(done).toBe(true);
  });

  it('a tool turn pins the pre-tool text before tool_start events flow', () => {
    const { draft, done } = runEvents([
      'data: {"type":"delta","data":{"content":"我先帮你看看资料"}}',
      'data: {"type":"message","data":{"content":"我先帮你看看资料","role":"assistant"}}',
      'data: {"type":"tool_start","data":{"name":"analyze_profile"}}',
      'data: {"type":"tool_end","data":{"name":"analyze_profile","result":{"score":80}}}',
      'data: {"type":"delta","data":{"content":"分析结果："}}',
      'data: {"type":"message","data":{"content":"分析结果：…","role":"assistant"}}',
      'data: {"type":"done","data":{"sessionId":"s1"}}',
    ]);
    expect(draft).toBe('分析结果：…');
    expect(done).toBe(true);
  });
});

describe('P189 · neighbouring paths unchanged', () => {
  it('session-change search reset is untouched', () => {
    const state = { open: true, query: '关键词', activeIndex: 2 };
    expect(resetSearchOnSessionChange(state, 's1', 's2')).toEqual(EMPTY_CHAT_SEARCH);
    expect(resetSearchOnSessionChange(state, 's1', 's1')).toBe(state);
    expect(resetSearchOnSessionChange(state, null, null)).toBe(state);
  });

  it('retry gating still only accepts a trailing failed assistant bubble', () => {
    const msgs: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: '出错了', error: true },
    ];
    expect(retryableMessageId(msgs)).toBe('a1');
    expect(retryableMessageId([...msgs, { id: 'a2', role: 'assistant', content: 'ok' }])).toBeNull();
  });
});

describe('P189 · source guards', () => {
  it('App read loop handles delta events through foldReplyDraft', () => {
    const app = read('App.tsx');
    expect(app).toContain("event.type === 'delta'");
    expect(app).toContain('foldReplyDraft');
    expect(app).toContain("from './lib/streamDraft'");
  });

  it('backend harness emits delta events from the streamed turn', () => {
    const harness = read('../../backend/src/agent/harness.ts');
    expect(harness).toContain("type: 'delta'");
    expect(harness).toContain('chatStream');
  });
});
