import { describe, expect, it } from 'vitest';
import { stripPromptEcho } from '../src/lib/reply-clean.js';

/**
 * P286 — the model sometimes leaks meta-reasoning about the
 * example-first rule as its first sentence (「按规则第一段必须先给…」)
 * before the pasteable example. stripPromptEcho removes that single
 * leading sentence, conservatively: it only fires when the reply opens
 * with a meta phrase, only strips one sentence, and never cuts into a
 * 「…」-wrapped example.
 */

describe('P286 · stripPromptEcho strips a leading meta-narration sentence', () => {
  it('drops 「按规则…」 opening and keeps the example that follows', () => {
    const reply =
      '按规则第一段必须先给示例文案。「我是个周末爱爬山的产品经理，想找个人一起分享好吃的馆子。」你看这句能不能直接用？';
    expect(stripPromptEcho(reply)).toBe(
      '「我是个周末爱爬山的产品经理，想找个人一起分享好吃的馆子。」你看这句能不能直接用？',
    );
  });

  it('drops 「根据要求」 and 「规则要求我」 openings', () => {
    expect(stripPromptEcho('根据要求先给一句示例。\n「慢热但真诚，喜欢做饭和livehouse。」')).toBe(
      '「慢热但真诚，喜欢做饭和livehouse。」',
    );
    expect(stripPromptEcho('规则要求我先给示例再提问！「爱笑的南方人，在北京做设计。」')).toBe(
      '「爱笑的南方人，在北京做设计。」',
    );
  });

  it('strips only the leading sentence, not a second meta sentence', () => {
    const reply = '按照约束给示例。「你好。」按照要求我还要问一句：你在哪个平台？';
    expect(stripPromptEcho(reply)).toBe('「你好。」按照要求我还要问一句：你在哪个平台？');
  });
});

describe('P286 · stripPromptEcho leaves normal replies untouched', () => {
  it('does not strip an opening that only mentions 规则 mid-sentence', () => {
    const reply = '交友资料的规则其实很简单：真诚比技巧更打动人。你平时在哪个平台活跃？';
    expect(stripPromptEcho(reply)).toBe(reply);
  });

  it('returns clean replies byte-identical', () => {
    const reply = '「我是个周末爱爬山的产品经理。」这句可以直接用。你想吸引什么样的人？';
    expect(stripPromptEcho(reply)).toBe(reply);
  });

  it('does not strip when the lead sentence contains a quoted example', () => {
    const reply = '按规则给的示例是「爱爬山的PM寻饭搭子」这样的文案。你觉得呢？';
    expect(stripPromptEcho(reply)).toBe(reply);
  });
});
