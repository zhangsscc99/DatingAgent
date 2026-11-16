import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';

/**
 * P200 — no-emoji rule in the system prompt. Assistant replies opened with
 * decorative emoji (e.g. 🎉) because SYSTEM_PROMPT had no instruction
 * against them. buildSystemPrompt is what harness.ts sends as the
 * role:'system' message, so asserting on its output — plus a source-level
 * guard on harness.ts — locks the rule in without hardcoding any key.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

describe('P200 · system prompt bans emoji decoration', () => {
  it('the prompt sent to the LLM forbids emoji decoration', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(prompt).toContain('不要使用 emoji');
    expect(prompt).toContain('表情符号');
  });

  it('the built prompt itself carries no emoji code points', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(EMOJI.test(prompt)).toBe(false);
  });

  it('the rule lives inside SYSTEM_PROMPT, sent as the role:system message', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('不要使用 emoji');
    expect(EMOJI.test(promptSource)).toBe(false);
    expect(harnessSrc).toContain("role: 'system'");
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
  });

  it('keeps the rest of the prompt contract intact', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('使用 Markdown 格式');
    expect(prompt).toContain('当需要专业分析时，主动调用工具');
    expect(prompt).toContain('{}');
  });
});
