import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LENGTH_DIRECTIVE,
  buildSystemPrompt,
} from '../src/agent/harness.js';

/**
 * P301 — the 「回答适中」 (default) tier used to append no length constraint
 * at all, so moderate replies ran 600+ characters over four dense paragraphs
 * (≈1.5–2 phone screens). The default prompt now carries an explicit
 * moderate-length contract; concise and detailed keep their existing
 * single-sentence hints and never inherit the moderate one.
 */
describe('P301 · moderate reply-length directive', () => {
  const profile = { name: '小林', age: 28 };

  it('the default prompt carries the moderate directive with explicit limits', () => {
    const prompt = buildSystemPrompt(profile, 'auto');
    expect(prompt).toContain(DEFAULT_LENGTH_DIRECTIVE);
    expect(prompt.endsWith(DEFAULT_LENGTH_DIRECTIVE)).toBe(true);
    expect(prompt).toContain('320');
    expect(prompt).toContain('4 段');
    expect(prompt).toContain('2 句');
  });

  it('the default prompt stays identical between the 2-arg and 3-arg calls', () => {
    expect(buildSystemPrompt(profile, 'auto', undefined)).toBe(
      buildSystemPrompt(profile, 'auto'),
    );
  });

  it('concise keeps only its own hint — never the moderate directive', () => {
    const prompt = buildSystemPrompt(profile, 'auto', 'concise');
    expect(prompt).toContain('请把回复写得更精简，控制在三点以内。');
    expect(prompt).not.toContain('请把回复写得更详细一些');
    expect(prompt).not.toContain(DEFAULT_LENGTH_DIRECTIVE);
    expect(prompt).not.toContain('控制在 320 字以内');
  });

  it('detailed keeps only its own hint — never the moderate directive', () => {
    const prompt = buildSystemPrompt(profile, 'auto', 'detailed');
    expect(prompt).toContain('请把回复写得更详细一些，给出更完整的步骤和例子。');
    expect(prompt).not.toContain('请把回复写得更精简');
    expect(prompt).not.toContain(DEFAULT_LENGTH_DIRECTIVE);
    expect(prompt).not.toContain('控制在 320 字以内');
  });
});
