import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';

/**
 * P209 — brevity rule for ultra-short / affect-only input. A two-character
 * 「嗯。」 drew a ~900-word checklist (「可以这样做」「接下来 24 小时内」…)
 * in one round and a 212-character comfort reply in another, so length
 * adaptation was unstable. The fix is a hard constraint inside
 * SYSTEM_PROMPT; buildSystemPrompt is what harness.ts sends as the
 * role:'system' message, so asserting on its output locks the rule in.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

describe('P209 · system prompt caps replies to ultra-short input', () => {
  it('names the short-input trigger (few chars or filler tokens)', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(prompt).toContain('不足 6 个字');
    expect(prompt).toContain('语气词');
    for (const token of ['嗯', '哦', '好', '在', '唉', '啊', '随便', '行吧']) {
      expect(prompt).toContain(token);
    }
  });

  it('caps the reply shape for that input', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('最多 3 个短段落');
    expect(prompt).toContain('不设小标题');
    expect(prompt).toContain('不用编号或要点清单');
    expect(prompt).toContain('可以这样做');
    expect(prompt).toContain('接下来 N 小时内');
    expect(prompt).toContain('最多一条具体建议');
  });

  it('keeps the 「详细」 escape hatch and the P200 no-emoji rule', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('用户明确要求「详细」时不受此限');
    expect(prompt).toContain('不要使用 emoji');
  });

  it('the rule lives inside SYSTEM_PROMPT, sent as the role:system message', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('短输入配短回复');
    expect(promptSource).toContain('最多 3 个短段落');
    expect(promptSource).toContain('用户明确要求「详细」时不受此限');
    expect(harnessSrc).toContain("role: 'system'");
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
  });
});
