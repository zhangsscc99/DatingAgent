import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';
import { stripManualLabels } from '../src/lib/reply-clean.js';

/**
 * P279 — answer-first rule for 话术 questions. The same 「我该怎么回」
 * question came back as either a 711-char manual (「选项一… / 解析：… /
 * 💡 避坑指南：…」, paste-ready line buried in paragraph three) or a
 * 276-char direct answer. The fix is a hard structure clause in
 * SYSTEM_PROMPT (first paragraph is one quoted ready-to-send line) plus a
 * stripManualLabels pass on the final reply before it is persisted.
 */

describe('P279 · system prompt answer-first rule for 话术 questions', () => {
  it('requires the first paragraph to be one ready-to-send line', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('第一段必须是一句可直接发送的原话');
  });

  it('forbids the manual-style labels', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('选项一');
    expect(prompt).toContain('解析：');
    expect(prompt).toContain('避坑指南');
  });

  it('keeps the explicit 多给几种/详细 exception', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('多给几种');
    expect(prompt).toContain('详细');
  });
});

describe('P279 · stripManualLabels', () => {
  it('strips emoji + labels, keeps the body text', () => {
    const cleaned = stripManualLabels('💡 避坑指南：不要秒回\n\n解析：直接表达兴趣');
    expect(cleaned).not.toContain('💡');
    expect(cleaned).not.toContain('避坑指南：');
    expect(cleaned).not.toContain('解析：');
    expect(cleaned).toContain('不要秒回');
    expect(cleaned).toContain('直接表达兴趣');
  });

  it('returns a plain reply byte-identical', () => {
    const plain = '“好啊，周六下午我有空。”\n\n这样回既接住了她的邀请，又不显得太急。';
    expect(stripManualLabels(plain)).toBe(plain);
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    expect(stripManualLabels('第一段\n\n\n\n第二段')).toBe('第一段\n\n第二段');
  });

  it('does not eat a numbered line', () => {
    const numbered = '1. 先确认时间\n2. 再定地点';
    expect(stripManualLabels(numbered)).toBe(numbered);
  });
});
