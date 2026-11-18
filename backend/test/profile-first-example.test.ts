import { describe, expect, it } from 'vitest';
import {
  PROFILE_EXAMPLE_FIRST_RULE,
  SYSTEM_PROMPT,
  buildProfileIntentDirective,
  buildSystemPrompt,
  isProfileIntent,
} from '../src/agent/harness.js';

/**
 * P286 — the 「帮我优化资料」 chip used to earn back only a questionnaire
 * (four follow-up questions, zero sample copy). The fix is an example-first
 * constraint in the exported SYSTEM_PROMPT constant plus a per-turn tail
 * directive when the current message is a profile/copywriting intent:
 * the first paragraph must carry one 「…」/code-block wrapped line of at
 * least 15 characters that the user can paste straight into their profile,
 * before at most two follow-up questions.
 */

describe('P286 · exported prompt constant carries the example-first rule', () => {
  it('names the profile-optimisation trigger', () => {
    expect(SYSTEM_PROMPT).toContain('资料优化');
    expect(SYSTEM_PROMPT).toContain('交友资料');
    expect(SYSTEM_PROMPT).toContain('个人简介');
    expect(SYSTEM_PROMPT).toContain('简介改写');
  });

  it('requires a directly pasteable example in the first paragraph', () => {
    expect(SYSTEM_PROMPT).toContain('第一段必须先给一句可直接粘贴的示例文案');
    expect(SYSTEM_PROMPT).toContain('「…」');
    expect(SYSTEM_PROMPT).toContain('不少于 15 字');
  });

  it('puts the example before the questions and caps them at two', () => {
    expect(SYSTEM_PROMPT).toContain('示例必须排在所有追问之前');
    expect(SYSTEM_PROMPT).toContain('最多追问 2 个问题');
    expect(SYSTEM_PROMPT).toContain('清单');
    expect(SYSTEM_PROMPT).toContain('同一种问句收尾');
    expect(SYSTEM_PROMPT).toContain('不要在回复中提及或复述这些要求');
  });

  it('the rendered system prompt for a profile-intent turn includes the block', () => {
    const prompt =
      buildSystemPrompt({ name: '小林' }, 'auto') +
      buildProfileIntentDirective('帮我优化一下我的个人资料');
    expect(prompt).toContain(PROFILE_EXAMPLE_FIRST_RULE);
    expect(prompt).toContain('可直接粘贴');
    expect(prompt).toContain('不少于 15 字');
  });

  it('restates the rule at the tail of the system message only for profile intent', () => {
    const directive = buildProfileIntentDirective('帮我优化一下我的个人资料');
    expect(directive).toContain(PROFILE_EXAMPLE_FIRST_RULE);
    expect(buildProfileIntentDirective('她三天没回我了怎么办')).toBe('');
  });
});

describe('P286 · isProfileIntent', () => {
  it.each([
    '帮我优化一下我的个人资料',
    '交友资料怎么写更吸引人',
    '帮我把简介改写得更真诚一点',
  ])('matches profile intent: %s', (text) => {
    expect(isProfileIntent(text)).toBe(true);
  });

  it.each(['她三天没回我了怎么办', '第一次约会去哪里比较好'])(
    'ignores non-profile intent: %s',
    (text) => {
      expect(isProfileIntent(text)).toBe(false);
    },
  );
});
