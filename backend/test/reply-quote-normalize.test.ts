import { describe, expect, it } from 'vitest';
import { normalizeCjkQuotes } from '../src/lib/reply-clean.js';

/**
 * P292 — the model sometimes wraps Chinese phrases in English curly “…”
 * or half-width straight "…" quotes while the rest of the reply uses 「」.
 * normalizeCjkQuotes rewrites only Chinese-context pairs (Han inside the
 * pair or directly beside it): pure-English quotes, unpaired lone marks,
 * fenced/inline code and URLs pass through byte-identical, and the
 * function is idempotent.
 */
describe('P292 · normalizeCjkQuotes converts Chinese-context pairs to 「」', () => {
  it('converts a curly “…” pair wrapping Chinese text', () => {
    expect(normalizeCjkQuotes('关键是让它自然流动，而不是“完成任务”。')).toBe(
      '关键是让它自然流动，而不是「完成任务」。',
    );
  });

  it('converts straight "…" pairs next to Han', () => {
    expect(normalizeCjkQuotes('你现在大脑在自动把"沉默"翻译成"危险"')).toBe(
      '你现在大脑在自动把「沉默」翻译成「危险」',
    );
  });

  it('converts a pair whose inner text is English but sits next to Han', () => {
    expect(normalizeCjkQuotes('她说的"fine"其实是"算了"')).toBe('她说的「fine」其实是「算了」');
  });

  it('is idempotent', () => {
    const reply = '把"沉默"换成“安静”试试';
    const once = normalizeCjkQuotes(reply);
    expect(once).toBe('把「沉默」换成「安静」试试');
    expect(normalizeCjkQuotes(once)).toBe(once);
  });
});

describe('P292 · normalizeCjkQuotes leaves non-Chinese-context quotes untouched', () => {
  it('returns a pure English line byte-identical', () => {
    const line = `She said "hello" and it's fine.`;
    expect(normalizeCjkQuotes(line)).toBe(line);
  });

  it('leaves English-quoted spans inside a Chinese reply alone', () => {
    const line = '可以说 "hello" 打招呼，但不要 overdo it';
    expect(normalizeCjkQuotes(line)).toBe(line);
  });

  it('leaves unpaired lone quotes alone', () => {
    expect(normalizeCjkQuotes('他说"算了')).toBe('他说"算了');
    expect(normalizeCjkQuotes('只剩一个“在前面')).toBe('只剩一个“在前面');
  });

  it('returns a quote-free reply byte-identical', () => {
    const reply = '今晚先别想太多，好好睡一觉。';
    expect(normalizeCjkQuotes(reply)).toBe(reply);
  });
});

describe('P292 · normalizeCjkQuotes never touches protected spans', () => {
  it('does not touch quotes inside fenced code blocks', () => {
    const reply = '看这段：\n```\nconst s = "你好"; // “注释”\n```\n懂了吗？';
    expect(normalizeCjkQuotes(reply)).toBe(reply);
  });

  it('leaves an unclosed trailing fence protected', () => {
    const reply = '比如这样：\n```ts\nconst s = "测试"';
    expect(normalizeCjkQuotes(reply)).toBe(reply);
  });

  it('does not touch inline code or URLs', () => {
    const reply = '用 `x = "沉默"` 或 https://example.com/?q="词" 都行，懂了"没"';
    expect(normalizeCjkQuotes(reply)).toBe(
      '用 `x = "沉默"` 或 https://example.com/?q="词" 都行，懂了「没」',
    );
  });
});
