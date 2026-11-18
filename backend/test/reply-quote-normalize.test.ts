import { describe, expect, it } from 'vitest';
import { normalizeCjkQuotes, stripSpaceAfterCjkPunct } from '../src/lib/reply-clean.js';

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

const STRAY_SPACE_AFTER_END = /[\u4e00-\u9fff][。！？][ \u00a0]/g;

/**
 * P306 — real replies carried a half-width space or   directly after
 * full-width 。！？ (five occurrences in one reply). stripSpaceAfterCjkPunct
 * removes them on Han-containing lines while fenced/inline code, URLs and
 * predominantly-English lines pass through byte-identical. Idempotent.
 */
describe('P306 · stripSpaceAfterCjkPunct removes space after 。！？', () => {
  const observed = [
    '先别想太多。 看展本身就是最好的话题发生器，跟着走就行。',
    '给你几个方向。 比如：问她最近想看的展。',
    '没关系。 偶尔一句没接好，不等于聊砸了。',
    '先忍住。 不发「你是不是不想去了」这种追问。',
    '她回了就是信号。 这个状态，周末见面时自然一点。',
  ];

  it('leaves zero Han+。！？+space matches in the five observed samples', () => {
    for (const sample of observed) {
      const cleaned = stripSpaceAfterCjkPunct(sample);
      expect(cleaned.match(STRAY_SPACE_AFTER_END) ?? []).toHaveLength(0);
    }
  });

  it('removes both half-width space and nbsp after 。！？', () => {
    expect(stripSpaceAfterCjkPunct('好了。 看下一句！\u00a0真的？ 对')).toBe('好了。看下一句！真的？对');
    expect(stripSpaceAfterCjkPunct('好了。\u00a0看下一句')).toBe('好了。看下一句');
  });

  it('collapses a run of spaces after full-width punctuation', () => {
    expect(stripSpaceAfterCjkPunct('说完了。   下一句')).toBe('说完了。下一句');
  });

  it('is idempotent', () => {
    const once = stripSpaceAfterCjkPunct('好了。 下一句！ 再来');
    expect(once).toBe('好了。下一句！再来');
    expect(stripSpaceAfterCjkPunct(once)).toBe(once);
  });

  it('returns a reply with no stray space byte-identical', () => {
    const reply = '今晚先别想太多，好好睡一觉。';
    expect(stripSpaceAfterCjkPunct(reply)).toBe(reply);
  });
});

describe('P306 · stripSpaceAfterCjkPunct never touches protected spans', () => {
  it('does not touch fenced code blocks, even unclosed', () => {
    const reply = '看这段：\n```\nconst s = "好。 看";\n```\n懂了。 吗？';
    expect(stripSpaceAfterCjkPunct(reply)).toBe('看这段：\n```\nconst s = "好。 看";\n```\n懂了。吗？');
    const unclosed = '比如：\n```ts\nconst s = "。 测试"';
    expect(stripSpaceAfterCjkPunct(unclosed)).toBe(unclosed);
  });

  it('does not touch inline code', () => {
    const reply = '用 `x = "。 值"` 就行，懂了。 没';
    expect(stripSpaceAfterCjkPunct(reply)).toBe('用 `x = "。 值"` 就行，懂了。没');
  });

  it('does not touch URLs', () => {
    const reply = '看这个 https://example.com/a?x=。%20y 链接，然后。 回来';
    expect(stripSpaceAfterCjkPunct(reply)).toBe('看这个 https://example.com/a?x=。%20y 链接，然后。回来');
  });

  it('leaves a pure English line byte-identical', () => {
    const line = 'He said "stop. look. listen." and left.';
    expect(stripSpaceAfterCjkPunct(line)).toBe(line);
  });

  it('leaves an English line containing full-width punctuation untouched', () => {
    const reply = '备注：done。\nSentence one。 Sentence two。 Still English line。';
    expect(stripSpaceAfterCjkPunct(reply)).toBe('备注：done。\nSentence one。 Sentence two。 Still English line。');
  });
});
