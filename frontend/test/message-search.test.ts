import { describe, expect, it } from 'vitest';
import {
  countMatches,
  highlightSegments,
  isSearching,
  matchMessages,
  normalizeQuery,
} from '../src/lib/messageSearch';
import type { ChatMessage } from '../src/types';

const msg = (id: string, role: ChatMessage['role'], content: string): ChatMessage => ({
  id,
  role,
  content,
});

describe('P19 · normalizeQuery', () => {
  it('trims, collapses internal whitespace, and lowercases', () => {
    expect(normalizeQuery('  Hello   World  ')).toBe('hello world');
    expect(normalizeQuery('a\tb\nc')).toBe('a b c');
    expect(normalizeQuery('ABOUT')).toBe('about');
    expect(normalizeQuery('')).toBe('');
  });

  it('caps the normalized query at 100 chars', () => {
    expect(normalizeQuery('x'.repeat(150))).toHaveLength(100);
    expect(normalizeQuery('y'.repeat(100))).toHaveLength(100);
  });
});

describe('P19 · isSearching', () => {
  it('is false for empty and whitespace-only input', () => {
    expect(isSearching('')).toBe(false);
    expect(isSearching('   ')).toBe(false);
    expect(isSearching(' \t\n ')).toBe(false);
  });

  it('is true once a normalized query is non-empty', () => {
    expect(isSearching(' hello ')).toBe(true);
    expect(isSearching('约')).toBe(true);
  });
});

describe('P19 · matchMessages', () => {
  const msgs = [
    msg('u1', 'user', '你好，帮我优化资料'),
    msg('a1', 'assistant', '当然，第一次约会建议先聊聊天'),
    msg('u2', 'user', 'The Restaurant was great'),
  ];

  it('returns [] for empty or whitespace-only queries', () => {
    expect(matchMessages(msgs, '')).toEqual([]);
    expect(matchMessages(msgs, '   ')).toEqual([]);
  });

  it('matches content case-insensitively', () => {
    expect(matchMessages(msgs, 'RESTAURANT').map((m) => m.id)).toEqual(['u2']);
    expect(matchMessages(msgs, 'the restaurant')).toEqual([msgs[2]]);
  });

  it('matches CJK substrings and preserves message order', () => {
    expect(matchMessages(msgs, '约会').map((m) => m.id)).toEqual(['a1']);
    const more = [...msgs, msg('u3', 'user', '再聊一次约会')];
    expect(matchMessages(more, '约会').map((m) => m.id)).toEqual(['a1', 'u3']);
  });

  it('returns [] when nothing matches and ignores fields other than content', () => {
    expect(matchMessages(msgs, '不存在')).toEqual([]);
    expect(matchMessages(msgs, 'assistant')).toEqual([]); // role is not searched
    expect(matchMessages(msgs, 'u1')).toEqual([]); // id is not searched
  });
});

describe('P19 · countMatches', () => {
  it('counts non-overlapping case-insensitive occurrences', () => {
    expect(countMatches('ababab', 'ab')).toBe(3);
    expect(countMatches('aaaa', 'aa')).toBe(2);
    expect(countMatches('aaa', 'aa')).toBe(1);
    expect(countMatches('Hello HELLO hello', 'hello')).toBe(3);
  });

  it('counts CJK occurrences', () => {
    expect(countMatches('约会规划和约会地点', '约会')).toBe(2);
  });

  it('returns 0 for an empty query or no match', () => {
    expect(countMatches('text', '')).toBe(0);
    expect(countMatches('text', '   ')).toBe(0);
    expect(countMatches('text', 'zzz')).toBe(0);
  });
});

describe('P19 · highlightSegments', () => {
  it('returns a single miss segment for an empty query', () => {
    expect(highlightSegments('hello', '')).toEqual([{ text: 'hello', hit: false }]);
    expect(highlightSegments('hello', '   ')).toEqual([{ text: 'hello', hit: false }]);
  });

  it('reconstructs the original text exactly and marks hits case-insensitively', () => {
    const text = 'The Cat sat. THE cat!';
    const segments = highlightSegments(text, 'cat');
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['Cat', 'cat']);
    expect(segments[0]).toEqual({ text: 'The ', hit: false });
  });

  it('splits around CJK hits and preserves order', () => {
    const text = '第一次约会建议：约会地点';
    const segments = highlightSegments(text, '约会');
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.hit)).toHaveLength(2);
    expect(segments[0]).toEqual({ text: '第一次', hit: false });
  });

  it('handles a query that spans the whole text', () => {
    expect(highlightSegments('hello', 'HELLO')).toEqual([{ text: 'hello', hit: true }]);
  });
});
