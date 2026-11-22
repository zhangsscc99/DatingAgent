/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHAT_SEARCH,
  regenerableMessageIds,
  resetSearchOnSessionChange,
  retryableMessageId,
} from '../src/lib/chatSearchState';
import type { ChatMessage } from '../src/types';

const user = (id: string, content = '你好'): ChatMessage => ({
  id,
  role: 'user',
  content,
});
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: 'reply',
  ...extra,
});

describe('P162 · resetSearchOnSessionChange', () => {
  const dirty = { open: true, query: '约会', activeIndex: 2 };

  it('keeps the state untouched when the session id did not change', () => {
    expect(resetSearchOnSessionChange(dirty, 's1', 's1')).toBe(dirty);
    expect(resetSearchOnSessionChange(dirty, null, null)).toBe(dirty);
    expect(resetSearchOnSessionChange(dirty, undefined, undefined)).toBe(dirty);
  });

  it('clears search state when the session id changed', () => {
    expect(resetSearchOnSessionChange(dirty, 's1', 's2')).toBe(EMPTY_CHAT_SEARCH);
    expect(resetSearchOnSessionChange(dirty, null, 's1')).toBe(EMPTY_CHAT_SEARCH);
    expect(resetSearchOnSessionChange(dirty, 's1', null)).toBe(EMPTY_CHAT_SEARCH);
    expect(resetSearchOnSessionChange(dirty, undefined, 's1')).toBe(
      EMPTY_CHAT_SEARCH,
    );
  });
});

describe('P162 · retryableMessageId', () => {
  it('returns the last message id when it is a failed assistant turn', () => {
    const msgs = [
      user('u1'),
      assistant('a1', { error: true, retryPrompt: '你好' }),
    ];
    expect(retryableMessageId(msgs)).toBe('a1');
  });

  it('returns null when the last row is a user message', () => {
    expect(retryableMessageId([user('u1'), assistant('a1'), user('u2')])).toBeNull();
    expect(retryableMessageId([user('u1')])).toBeNull();
  });

  it('returns null while the last reply is streaming', () => {
    const msgs = [user('u1'), assistant('a1', { content: '', streaming: true })];
    expect(retryableMessageId(msgs)).toBeNull();
  });

  it('returns null for an older error bubble — only the true tail retries', () => {
    const msgs = [
      user('u1'),
      assistant('a1', { error: true, retryPrompt: '你好' }),
      user('u2'),
      assistant('a2'),
    ];
    expect(retryableMessageId(msgs)).toBeNull();
  });

  it('returns null for a settled reply and for an empty conversation', () => {
    expect(retryableMessageId([user('u1'), assistant('a1')])).toBeNull();
    expect(retryableMessageId([])).toBeNull();
  });
});

describe('P438 · regenerableMessageIds', () => {
  it('marks every settled assistant reply that answers a user message', () => {
    const msgs = [user('u1'), assistant('a1'), user('u2'), assistant('a2')];
    expect(regenerableMessageIds(msgs)).toEqual(new Set(['a1', 'a2']));
  });

  it('is empty for a single-message conversation', () => {
    expect(regenerableMessageIds([assistant('a1')]).size).toBe(0);
    expect(regenerableMessageIds([user('u1')])).toEqual(new Set());
    expect(regenerableMessageIds([])).toEqual(new Set());
  });

  it('skips a reply whose previous message is not from the user', () => {
    const msgs = [user('u1'), assistant('a1'), assistant('a2')];
    expect(regenerableMessageIds(msgs)).toEqual(new Set(['a1']));
  });

  it('marks older replies even when the last row is a user message', () => {
    expect(regenerableMessageIds([user('u1'), assistant('a1'), user('u2')])).toEqual(
      new Set(['a1']),
    );
  });

  it('skips error and still-streaming replies', () => {
    expect(
      regenerableMessageIds([
        user('u1'),
        assistant('a1', { error: true, retryPrompt: '你好' }),
      ]),
    ).toEqual(new Set());
    expect(
      regenerableMessageIds([
        user('u1'),
        assistant('a1', { content: '', streaming: true }),
      ]),
    ).toEqual(new Set());
  });
});

/**
 * Source-level guard (same style as a11y.test.ts): ChatWindow must bind the
 * retry/regenerate callbacks by message id, never by the filtered list index.
 */
describe('P162 · ChatWindow binds actions by id, not filtered index', () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'src',
      'components',
      'ChatWindow.tsx',
    ),
    'utf8',
  );

  it('no longer gates the buttons on renderedMessages.length - 1', () => {
    expect(source).not.toContain('renderedMessages.length - 1');
  });

  it('uses the id-based helpers from chatSearchState', () => {
    expect(source).toContain('retryableMessageId');
    expect(source).toContain('regenerableMessageId');
  });
});
