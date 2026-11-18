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

/**
 * P288 — the example line was being invented with concrete hobbies
 * (手冲咖啡 / 旧书店 / 木工) and never marked as a template, so the user
 * could think the consultant already knew — or was fabricating — their
 * profile. The rule now requires an explicit 「示例」 marker (prefix or a
 * following 「换成你自己的」 sentence) and neutral generic placeholders.
 */
describe('P288 · example is marked as a template with neutral placeholders', () => {
  it('requires the sample line to be marked as an example', () => {
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('示例：');
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('换成你自己的');
    expect(SYSTEM_PROMPT).toContain('示例：');
    expect(SYSTEM_PROMPT).toContain('换成你自己的');
  });

  it('requires neutral generic placeholders and forbids invented specifics', () => {
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('你的爱好');
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('你的职业');
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('不要编造');
    expect(SYSTEM_PROMPT).toContain('不要编造用户没提过的具体爱好、职业、品牌或地点');
  });

  it('keeps the two-question cap and the escape hatch', () => {
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('最多追问 2 个问题');
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('只问问题不给示例');
    expect(PROFILE_EXAMPLE_FIRST_RULE).toContain('不要在回复中提及或复述这些要求');
  });

  it('the rule lives in the exported constant exactly once (no duplication drift)', () => {
    const occurrences = SYSTEM_PROMPT.split(PROFILE_EXAMPLE_FIRST_RULE).length - 1;
    expect(occurrences).toBe(1);
    expect(buildProfileIntentDirective('帮我优化一下我的个人资料')).toContain(
      '换成你自己的',
    );
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
