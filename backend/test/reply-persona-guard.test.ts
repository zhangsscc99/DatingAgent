import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';
import { stripStageDirections } from '../src/lib/reply-clean.js';

/**
 * P242 — anti-roleplay guard. An emotionally fragile input (「她昨天没回我
 * 消息，我一晚上没睡好」) made the model answer as a virtual lover:
 * 「（轻轻揉了揉你的头发，把你拉进怀里）怎么了…（心疼地）来，靠着我休息
 * 会儿…（小声）乖，先眯一会儿」 — parenthesised stage directions plus
 * endearments and zero usable advice. The fix is a hard 禁止角色扮演
 * clause in SYSTEM_PROMPT (buildSystemPrompt is what harness.ts sends as
 * the role:'system' message) plus a stripStageDirections pass on the reply
 * before it is persisted.
 */

describe('P242 · system prompt forbids the role-play persona', () => {
  it('contains the anti-roleplay clause', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('禁止角色扮演');
    expect(prompt).toContain('舞台提示');
    expect(prompt).toContain('顾问');
  });
});

describe('P242 · stripStageDirections', () => {
  it('removes a leading full-width stage direction, keeps the body', () => {
    expect(stripStageDirections('（心疼地）来，靠着我休息会儿')).toBe('来，靠着我休息会儿');
  });

  it('removes a multi-action stage direction', () => {
    expect(stripStageDirections('（轻轻揉了揉你的头发，把你拉进怀里）怎么了')).toBe('怎么了');
  });

  it('removes ASCII-parenthesised directions too', () => {
    expect(stripStageDirections('(sighs) 我在这儿')).toBe('我在这儿');
  });

  it('leaves a plain reply byte-identical', () => {
    const plain = '先深呼吸。她可能只是忙，晚点发一条轻松的问候就好。';
    expect(stripStageDirections(plain)).toBe(plain);
  });

  it('keeps paragraphs and leaves no double blank lines', () => {
    const reply = '第一段：先接住情绪。\n\n（叹气）\n\n第二段：给一条具体建议。';
    const cleaned = stripStageDirections(reply);
    expect(cleaned).toBe('第一段：先接住情绪。\n\n第二段：给一条具体建议。');
    expect(cleaned).not.toContain('\n\n\n');
  });
});
