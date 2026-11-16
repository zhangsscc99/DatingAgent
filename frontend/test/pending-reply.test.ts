import { describe, expect, it } from 'vitest';
import {
  canGenerateReply,
  needsReply,
  pendingReplyPrompt,
} from '../src/lib/pendingReply';
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

describe('P161 · needsReply', () => {
  it('is true for a single unanswered user message', () => {
    expect(needsReply([user('u1')])).toBe(true);
  });

  it('is true when the last row is user, even with several user rows', () => {
    expect(needsReply([user('u1'), user('u2')])).toBe(true);
    expect(needsReply([user('u1'), assistant('a1'), user('u2')])).toBe(true);
  });

  it('is false once an assistant reply exists, and for an empty list', () => {
    expect(needsReply([user('u1'), assistant('a1')])).toBe(false);
    expect(needsReply([])).toBe(false);
  });

  it('is false while a reply is streaming — a streaming row counts as a reply in flight', () => {
    expect(
      needsReply([user('u1'), assistant('a1', { content: '', streaming: true })]),
    ).toBe(false);
  });

  it('is false when the trailing row is an error assistant bubble', () => {
    expect(
      needsReply([
        user('u1'),
        assistant('a1', { error: true, retryPrompt: '你好' }),
      ]),
    ).toBe(false);
  });
});

describe('P161 · pendingReplyPrompt', () => {
  it('returns the trailing user text so the turn can be re-issued verbatim', () => {
    expect(pendingReplyPrompt([user('u1', '帮我写开场白')])).toBe('帮我写开场白');
    expect(pendingReplyPrompt([user('u1'), assistant('a1')])).toBeNull();
    expect(pendingReplyPrompt([])).toBeNull();
  });

  it('returns null for a whitespace-only user message', () => {
    expect(pendingReplyPrompt([user('u1', '   ')])).toBeNull();
  });
});

describe('P161 · canGenerateReply — the click-twice guard', () => {
  it('yields exactly one reply: once busy flips, a second click is a no-op', () => {
    const msgs = [user('u1', '继续聊')];
    // First click evaluates while idle → the turn may start; the handler
    // then sets busy, so every evaluation after that must refuse.
    expect(canGenerateReply(msgs, false)).toBe(true);
    expect(canGenerateReply(msgs, true)).toBe(false);
  });

  it('never starts when the conversation is not awaiting a reply', () => {
    expect(canGenerateReply([user('u1'), assistant('a1')], false)).toBe(false);
    expect(canGenerateReply([], false)).toBe(false);
    expect(
      canGenerateReply(
        [user('u1'), assistant('a1', { streaming: true })],
        false,
      ),
    ).toBe(false);
  });
});
