import { describe, expect, it } from 'vitest';
import { normalizeChinesePunctuation } from '../src/lib/reply-clean.js';

/**
 * P282 — the model sometimes leaks half-width `,` `?` `!` `:` next to Han
 * characters in an otherwise full-width reply. normalizeChinesePunctuation
 * converts only those Han-adjacent marks: fenced/inline code, URLs, pure
 * ASCII text and digit-adjacent marks (「1,000」「12:30」) pass through
 * byte-identical, and the function is idempotent.
 */

describe('P282 · normalizeChinesePunctuation converts Han-adjacent half-width marks', () => {
  it('converts `,` and `?` between Han characters', () => {
    expect(normalizeChinesePunctuation('等你了,把手机放远一点?')).toBe('等你了，把手机放远一点？');
  });

  it('converts every half-width mark adjacent to Han in a longer sentence', () => {
    expect(normalizeChinesePunctuation('听着,先深呼吸!今晚别再盯对话框了:明天再看也不迟?'))
      .toBe('听着，先深呼吸！今晚别再盯对话框了：明天再看也不迟？');
  });

  it('converts a mark after Han at end of line or before whitespace', () => {
    expect(normalizeChinesePunctuation('什么内容? 我帮你看看')).toBe('什么内容？ 我帮你看看');
    expect(normalizeChinesePunctuation('先睡吧!')).toBe('先睡吧！');
  });
});

describe('P282 · normalizeChinesePunctuation leaves non-Han text untouched', () => {
  it('returns a pure English line byte-identical', () => {
    const line = 'Hello, world? Yes: sure!';
    expect(normalizeChinesePunctuation(line)).toBe(line);
  });

  it('does not touch punctuation inside fenced code blocks', () => {
    const reply = '看下这段:\n```\nfoo,bar? baz: qux!\n```\n懂了吗?';
    expect(normalizeChinesePunctuation(reply)).toBe(
      '看下这段：\n```\nfoo,bar? baz: qux!\n```\n懂了吗？',
    );
  });

  it('does not touch inline code or URLs', () => {
    const reply = '用这个 `a,b?c` 再看 https://example.com/x?q=1,b=2 就懂了?';
    expect(normalizeChinesePunctuation(reply)).toBe(
      '用这个 `a,b?c` 再看 https://example.com/x?q=1,b=2 就懂了？',
    );
  });

  it('keeps digit-adjacent marks like 1,000 and 12:30 inside Chinese text', () => {
    expect(normalizeChinesePunctuation('花了1,000块,约了12:30见')).toBe('花了1,000块，约了12:30见');
  });

  it('is idempotent', () => {
    const reply = '今晚先别等了,把手机放远一点,能睡就睡?明天再说:好吗!';
    const once = normalizeChinesePunctuation(reply);
    expect(normalizeChinesePunctuation(once)).toBe(once);
  });
});
