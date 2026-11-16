import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';

/**
 * P217 — scene-specific brevity for 「首次见家长 / 见父母」-type
 * high-emotion questions. That question came back as ~3000 characters in
 * five numbered sections (一、最重要的原则 / 二、穿什么 / …), unreadable
 * for someone who is nervous right now. The fix is a hard constraint inside
 * SYSTEM_PROMPT: one reassuring sentence, at most three concrete actions
 * (穿什么 / 带什么 / 怎么开口), then a follow-up question instead of the
 * full dump. buildSystemPrompt is what harness.ts sends as the
 * role:'system' message, so asserting on its output locks the rule in.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

describe('P217 · system prompt caps 见家长-type high-emotion replies', () => {
  it('names the scene trigger (见家长 / 见父母 / 第一次见对方家人)', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(prompt).toContain('高情绪场景');
    expect(prompt).toContain('首次见家长');
    expect(prompt).toContain('见父母');
    expect(prompt).toContain('第一次见对方家人');
  });

  it('caps the reply shape: one reassurance, three one-line actions, one follow-up', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('一句话安抚情绪');
    expect(prompt).toContain('最多给三条可执行动作');
    expect(prompt).toContain('穿什么');
    expect(prompt).toContain('带什么');
    expect(prompt).toContain('开场怎么开口');
    expect(prompt).toContain('追问收尾');
    expect(prompt).toContain('想先细聊哪一块');
  });

  it('forbids markdown headings and multi-section dumps in that scene', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('不用 Markdown 标题');
    expect(prompt).toContain('不设小节');
    expect(prompt).toContain('不展开成清单');
  });

  it('does not conflict with the P200 no-emoji rule or the P209 short-input rule', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('不要使用 emoji');
    expect(prompt).toContain('短输入配短回复');
    // Same escape hatch as P209, carried inside the scene bullet itself:
    // an explicit 「详细」 request still wins.
    const sceneBullet = prompt.split('\n').find((l) => l.includes('高情绪场景')) ?? '';
    expect(sceneBullet).toContain('用户明确要求「详细」时不受此限');
  });

  it('the rule lives inside SYSTEM_PROMPT, sent as the role:system message', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('高情绪场景');
    expect(promptSource).toContain('首次见家长');
    expect(promptSource).toContain('最多给三条可执行动作');
    expect(promptSource).toContain('想先细聊哪一块');
    expect(harnessSrc).toContain("role: 'system'");
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
  });
});
