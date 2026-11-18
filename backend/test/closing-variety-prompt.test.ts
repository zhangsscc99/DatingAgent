import { describe, expect, it } from 'vitest';
import {
  CLOSING_VARIETY_RULE,
  PROFILE_EXAMPLE_FIRST_RULE,
  SYSTEM_PROMPT,
  buildSystemPrompt,
} from '../src/agent/harness.js';

/**
 * P283 — five of six sampled replies (rounds 77/78) closed on the same
 * 「要不要我…」/「方便的话告诉我…」 template, so the endings read like one
 * line with swapped words. The fix is a single closing-variety rule in
 * SYSTEM_PROMPT: the same closing form must not repeat within three
 * consecutive turns, and emotionally fragile input earns a doable action
 * instead of another question.
 */

describe('P283 · exported prompt constant carries the closing-variety rule', () => {
  it('names the overused closing question shapes to avoid', () => {
    expect(SYSTEM_PROMPT).toContain('要不要我');
    expect(SYSTEM_PROMPT).toContain('方便的话告诉我');
    expect(SYSTEM_PROMPT).toContain('想先细聊哪一块');
    expect(SYSTEM_PROMPT).toContain('不要每轮用同一个句式收尾');
  });

  it('forbids repeating one closing form within three consecutive turns', () => {
    expect(SYSTEM_PROMPT).toContain('连续三轮内不要重复同一种收尾形式');
    expect(SYSTEM_PROMPT).toContain('干脆不问');
  });

  it('prefers a directly doable action over a question for fragile input', () => {
    expect(SYSTEM_PROMPT).toContain('情绪脆弱或焦虑');
    expect(SYSTEM_PROMPT).toContain('可以直接做的动作');
    expect(SYSTEM_PROMPT).toContain('不要把提问当成每条回复的固定结尾');
  });

  it('keeps the same rule style: no emoji, no meta-narration', () => {
    expect(CLOSING_VARIETY_RULE).toContain('不使用 emoji');
    expect(CLOSING_VARIETY_RULE).toContain('不要在回复中提及或复述这些要求');
  });

  it('the rule appears exactly once in the rendered system prompt', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(prompt.split(CLOSING_VARIETY_RULE)).toHaveLength(2);
    expect(prompt.split('连续三轮')).toHaveLength(2);
  });

  it('pre-existing prompt anchors survive', () => {
    expect(SYSTEM_PROMPT).toContain('话术类提问先给原话');
    expect(SYSTEM_PROMPT).toContain(PROFILE_EXAMPLE_FIRST_RULE);
  });
});
