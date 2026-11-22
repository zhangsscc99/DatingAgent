import { describe, expect, it } from 'vitest';
import { regeneratePromptFor } from '../src/lib/regenerate';
import type { ChatMessage } from '../src/types';

const user = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
});
const assistant = (id: string, content = 'reply'): ChatMessage => ({
  id,
  role: 'assistant',
  content,
});

describe('P26 · regeneratePromptFor', () => {
  it('returns the user prompt directly before the last assistant reply', () => {
    const msgs = [
      user('u1', '你好'),
      assistant('a1'),
      user('u2', '帮我规划一次约会'),
      assistant('a2'),
    ];
    expect(regeneratePromptFor(msgs, 'a2')).toBe('帮我规划一次约会');
  });

  it('P438: an older assistant bubble re-rolls too — returns its own prompt', () => {
    const msgs = [user('u1', '你好'), assistant('a1'), user('u2', '二'), assistant('a2')];
    expect(regeneratePromptFor(msgs, 'a1')).toBe('你好');
  });

  it('rejects non-assistant targets and unknown ids', () => {
    const msgs = [user('u1', '你好'), assistant('a1')];
    expect(regeneratePromptFor(msgs, 'u1')).toBeNull();
    expect(regeneratePromptFor(msgs, 'missing')).toBeNull();
    expect(regeneratePromptFor([], 'a1')).toBeNull();
  });

  it('rejects a last reply with no user message before it', () => {
    expect(regeneratePromptFor([assistant('a1')], 'a1')).toBeNull();
    expect(
      regeneratePromptFor([assistant('a1'), assistant('a2')], 'a2'),
    ).toBeNull();
  });
});
