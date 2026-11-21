import { describe, expect, it } from 'vitest';
import { CLINIC_TERMS, softenClinicTerms } from '../src/lib/reply-clean.js';

/**
 * P406 — consulting-jargon metaphors (「新鲜感退潮」「热度自然回落」
 * 「消耗自己」「情感账户」) made the Round 103 replies read like template
 * paste-ups. softenClinicTerms rewrites each term to everyday wording,
 * leaves fenced code, quoted user speech and URLs untouched, and is
 * idempotent — a second pass is byte-identical.
 */

describe('P406 · softenClinicTerms', () => {
  it('rewrites jargon into everyday wording', () => {
    const out = softenClinicTerms('她最近热度自然回落，你可能在消耗自己');
    expect(out).not.toContain('热度自然回落');
    expect(out).not.toContain('消耗自己');
    expect(out).toContain('联系少了些');
    expect(out).toContain('勉强自己');
  });

  it('rewrites every banned term in CLINIC_TERMS', () => {
    const out = softenClinicTerms(CLINIC_TERMS.join('，'));
    for (const term of CLINIC_TERMS) {
      expect(out).not.toContain(term);
    }
  });

  it('is idempotent', () => {
    const input = '新鲜感退潮了，热度自然回落，你在消耗自己，情感账户见底。';
    expect(softenClinicTerms(softenClinicTerms(input))).toBe(softenClinicTerms(input));
    expect(softenClinicTerms(input)).not.toContain('了了');
  });

  it('leaves fenced code, quoted user speech and URLs untouched', () => {
    const sample =
      '她原话是「我已经在消耗自己了」，热度自然回落。\n' +
      '```\n热度自然回落\n```\n' +
      '资料里写 “新鲜感退潮” 是误译。\n' +
      '参考 https://example.com/情感账户';
    const out = softenClinicTerms(sample);
    expect(out).toContain('「我已经在消耗自己了」');
    expect(out).toContain('```\n热度自然回落\n```');
    expect(out).toContain('“新鲜感退潮”');
    expect(out).toContain('https://example.com/情感账户');
    // The unquoted jargon in the first line is still cleaned.
    expect(out).toContain('她原话是「我已经在消耗自己了」，联系少了些。');
  });

  it('returns plain text with no jargon byte-identical', () => {
    const plain = '先深呼吸。她可能只是忙，晚点发一条轻松的问候就好。';
    expect(softenClinicTerms(plain)).toBe(plain);
  });
});
