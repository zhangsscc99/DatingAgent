import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';
import { CLINIC_TERMS } from '../src/lib/reply-clean.js';

/**
 * P406 — Round 103 replies kept reaching for a consulting-jargon kit
 * (「新鲜感退潮」「热度自然回落」「消耗自己」) that made them read like
 * template paste-ups. The fix is a wording constraint inside SYSTEM_PROMPT:
 * relationship changes must be said in one everyday sentence, the jargon
 * set is banned outright, and replies should prefer concrete actions
 * (「什么时候、发什么、怎么回」) over state diagnosis. buildSystemPrompt is
 * what harness.ts sends as the role:'system' message, so asserting on its
 * output locks the rule in. The banned-term list is imported from
 * CLINIC_TERMS so the prompt and the reply-clean pass share one source.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

describe('P406 · system prompt bans consulting jargon', () => {
  it('requires everyday wording for relationship changes', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('描述关系变化用一句日常说法');
    expect(prompt).toContain('不做状态诊断');
  });

  it('lists at least the four banned terms', () => {
    const prompt = buildSystemPrompt({ name: '小林' }, 'auto');
    expect(CLINIC_TERMS.length).toBeGreaterThanOrEqual(4);
    for (const term of ['新鲜感退潮', '热度自然回落', '消耗自己', '情感账户']) {
      expect(prompt).toContain(term);
    }
  });

  it('prefers concrete actions (什么时候、发什么、怎么回)', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('什么时候、发什么、怎么回');
  });

  it('the rule lives inside SYSTEM_PROMPT, sent as the role:system message', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('NO_CLINIC_TERMS_RULE');
    expect(harnessSrc).toContain("role: 'system'");
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
  });
});
