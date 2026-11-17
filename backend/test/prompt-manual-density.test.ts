import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';

/**
 * P235 — 「看展前要准备什么」 used to come back as a 1400+ character manual
 * with five numbered h3 sub-headings and every sample line wrapped in a
 * blockquote. The fix is a hard constraint inside SYSTEM_PROMPT: at most
 * 3 short paragraphs and at most 3 bullets, no h3 sub-headings, no `## `
 * sections, and sample lines written as inline quotes. buildSystemPrompt is
 * what harness.ts sends as the role:'system' message, so asserting on its
 * output locks the rule in.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

describe('P235 · system prompt caps 准备/清单类 replies', () => {
  it('names the trigger (要准备什么 / 需要注意什么 / 清单)', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(prompt).toContain('要准备什么');
    expect(prompt).toContain('需要注意什么');
    expect(prompt).toContain('有什么清单');
  });

  it('caps the reply shape: 最多 3 个短段落 and 最多 3 条要点', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('最多 3 个短段落');
    expect(prompt).toContain('最多 3 条要点');
  });

  it('forbids h3 sub-headings, ## sections and blockquote sample lines', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('不设 h3 编号小标题');
    expect(prompt).toContain('不用 ## 标题分节');
    expect(prompt).toContain('行内引号');
    expect(prompt).toContain('而不是 blockquote 引用块');
  });

  it('exempts explicit 详细/完整清单 requests, inside the rule bullet itself', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    const bullet = prompt.split('\n').find((l) => l.includes('要准备什么')) ?? '';
    expect(bullet).toContain('用户明确要求「详细」或「完整清单」时不受此限');
  });

  it('the rule lives inside SYSTEM_PROMPT, sent as the role:system message', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('要准备什么');
    expect(promptSource).toContain('最多 3 个短段落');
    expect(promptSource).toContain('最多 3 条要点');
    expect(harnessSrc).toContain("role: 'system'");
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
  });
});
