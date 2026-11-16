/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeStoredSessions,
  serializeMessages,
} from '../src/lib/chatStorage';
import { canGenerateReply, needsReply } from '../src/lib/pendingReply';
import type { ChatMessage } from '../src/types';

/**
 * P169 — an abort before the first token used to land a blank assistant
 * bubble that was then persisted, so a refresh left an unanswerable empty
 * bubble with no retry/regenerate/「生成回复」 affordance. These tests lock
 * the two-sided fix: the App abort branch drops the empty placeholder (and
 * keeps a partial reply flagged stopped), and serializeMessages never
 * persists a blank assistant bubble or drops the stopped flag. No DOM
 * harness exists here, so the App/MessageBubble wiring is guarded at source
 * level (same approach as stop-generation.test.ts).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const user = (id: string, content = '今晚去哪儿约会好'): ChatMessage => ({
  id,
  role: 'user',
  content,
});
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  ...extra,
});

describe('P169 · abort before the first token', () => {
  it('the App abort branch filters the placeholder out instead of landing an empty bubble', () => {
    const app = read('App.tsx');
    const start = app.indexOf("name === 'AbortError'");
    const abortBranch = app.slice(start, app.indexOf('请求失败', start));
    // Empty content → remove the bubble; partial content → keep + stopped.
    expect(abortBranch).toContain('finalContent.trim()');
    expect(abortBranch).toContain('m.id !== assistantId');
    expect(abortBranch.indexOf('filter')).toBeLessThan(
      abortBranch.indexOf('upsertAssistant'),
    );
    expect(abortBranch).toContain('stopped: true');
  });

  it('leaves the trailing user message last, so 「生成回复」 is offered', () => {
    // Post-removal state is exactly what P161 was built for.
    const postAbort = [user('u1')];
    expect(needsReply(postAbort)).toBe(true);
    expect(canGenerateReply(postAbort, false)).toBe(true);
    // …and the placeholder itself is what would have suppressed it.
    const withPlaceholder = [...postAbort, assistant('a1', { streaming: true })];
    expect(needsReply(withPlaceholder)).toBe(false);
  });

  it('serializeMessages never persists a blank assistant bubble', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const serialized = serializeMessages([
        user('u1'),
        assistant('a1', { content: blank, stopped: true }),
      ]);
      expect(serialized.map((m) => m.id)).toEqual(['u1']);
    }
  });

  it('a blank bubble already stored by the old bug is dropped on rehydrate', () => {
    const [session] = normalizeStoredSessions([
      {
        id: 's1',
        title: 't',
        updatedAt: 1,
        messages: [
          user('u1'),
          assistant('a1', { content: '', stopped: true }),
          assistant('a2', { content: '   ' }),
        ],
      },
    ]);
    expect(session.messages.map((m) => m.id)).toEqual(['u1']);
  });
});

describe('P169 · abort after partial content', () => {
  it('keeps the partial text and persists stopped: true', () => {
    const serialized = serializeMessages([
      user('u1'),
      assistant('a1', { content: '可以先从共同兴趣聊起', stopped: true }),
    ]);
    expect(serialized).toHaveLength(2);
    expect(serialized[1].content).toBe('可以先从共同兴趣聊起');
    expect(serialized[1].stopped).toBe(true);
  });

  it('stopped survives a serialize → JSON → rehydrate round-trip', () => {
    const serialized = serializeMessages([
      user('u1'),
      assistant('a1', { content: '半句回复', stopped: true }),
    ]);
    const [session] = normalizeStoredSessions(
      JSON.parse(
        JSON.stringify([
          { id: 's1', title: 't', updatedAt: 1, messages: serialized },
        ]),
      ),
    );
    expect(session.messages[1].stopped).toBe(true);
    expect(session.messages[1].content).toBe('半句回复');
  });

  it('a stopped bubble is still a reply — 「生成回复」 stays hidden', () => {
    const messages = [user('u1'), assistant('a1', { content: '半句', stopped: true })];
    expect(needsReply(messages)).toBe(false);
  });

  it('MessageBubble renders a dim stopped note for the flag', () => {
    const bubble = read('components/MessageBubble.tsx');
    expect(bubble).toContain('message.stopped');
    expect(bubble).toContain('stopped-note');
    expect(bubble).toContain('已停止');
    const css = read('components/MessageBubble.css');
    expect(css).toContain('.stopped-note');
    expect(css).toContain('--text-muted');
  });
});

describe('P169 · normally completed replies', () => {
  it('a finished message carries no stopped flag', () => {
    const serialized = serializeMessages([
      user('u1'),
      assistant('a1', { content: '完整回复' }),
    ]);
    expect(serialized[1].content).toBe('完整回复');
    expect('stopped' in serialized[1]).toBe(false);
  });

  it('still strips the transient streaming placeholder wholesale', () => {
    const serialized = serializeMessages([
      user('u1'),
      assistant('a1', { content: '', streaming: true, streamPhase: 'thinking' }),
    ]);
    expect(serialized.map((m) => m.id)).toEqual(['u1']);
  });
});
