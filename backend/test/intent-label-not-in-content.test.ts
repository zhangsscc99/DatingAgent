import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripManualLabels } from '../src/lib/reply-clean.js';

/**
 * P373 — desktop replies opened with the intent chip text baked into the
 * body (「排约会\n✓\n\n明天第一次约会…」), so the bubble's first line read
 * as a UI label. The prompt already forbids it and the chip strip renders
 * outside the bubble; this locks the data-side guarantee: the cleaner the
 * harness applies must strip a leading interface label, and the harness
 * prompt rule must still be there.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

const LEADING_LABEL = /^(排约会|接话术|改资料|看匹配|关系建议)\s*\n?\s*✓/;

function firstNonEmptyLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0) ?? '';
}

describe('P373 interface labels can never lead the reply body', () => {
  it('strips a leading 「排约会 ✓」 chip block', () => {
    const cleaned = stripManualLabels(
      '排约会\n✓\n\n明天第一次约会，最稳的是咖啡 + 城市漫步，轻松不尴尬。',
    );
    expect(cleaned).not.toMatch(LEADING_LABEL);
    expect(firstNonEmptyLine(cleaned)).not.toContain('✓');
    expect(cleaned).toContain('明天第一次约会');
  });

  it('strips a single-line 「关系建议 ✓」 lead', () => {
    const cleaned = stripManualLabels('关系建议 ✓\n先别急着下结论，她回得慢不等于没兴趣。');
    expect(cleaned).not.toMatch(LEADING_LABEL);
    expect(firstNonEmptyLine(cleaned)).not.toContain('✓');
  });

  it('leaves ordinary replies byte-identical', () => {
    const body = '明天第一次约会，最稳的是咖啡加城市漫步。';
    expect(stripManualLabels(body)).toBe(body);
  });

  it('does not eat the same words mid-sentence', () => {
    const body = '她问你们合不合适，其实是在等一个排约会之外的答案。';
    expect(stripManualLabels(body)).toBe(body);
  });

  it('harness prompt still forbids interface labels in the reply body', () => {
    expect(harnessSrc).toContain('不要出现界面按钮名或工具标签');
  });
});
