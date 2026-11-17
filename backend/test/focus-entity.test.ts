import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/agent/types.js';
import { buildFocusDirective, buildSystemPrompt } from '../src/agent/harness.js';
import { extractPersonTerms, resolveFocusEntity } from '../src/lib/focusEntity.js';

/**
 * P233 — a turn that only says 「她」 used to be answered as if it were still
 * about 「妈妈」 from the previous turn. resolveFocusEntity + the appended
 * directive pin the reply to the person the CURRENT message names.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const harnessSrc = readFileSync(join(SRC, 'agent', 'harness.ts'), 'utf8');

const MOM_HISTORY: Message[] = [
  { role: 'user', content: '我妈一直催我相亲，搞得我压力很大，怎么办？' },
  { role: 'assistant', content: '妈妈的催促多半出于关心，先别急着顶回去。' },
];

const HER_MESSAGE = '她答应周末一起去看展了，我挺开心的，需要提前准备什么吗？';

describe('P233 · extractPersonTerms', () => {
  it('returns terms in first-appearance order, longest match first', () => {
    expect(extractPersonTerms('我妈妈说她也想来')).toEqual(['我妈妈', '她']);
    expect(extractPersonTerms(HER_MESSAGE)).toEqual(['她']);
    expect(extractPersonTerms('今天天气不错')).toEqual([]);
    // 「女友」 inside 「女朋友」 is swallowed by the longer match.
    expect(extractPersonTerms('女朋友和男友都到了')).toEqual(['女朋友', '男友']);
  });
});

describe('P233 · resolveFocusEntity', () => {
  it('keeps the focus on 「她」 and marks 「妈妈」 as stale', () => {
    const r = resolveFocusEntity(MOM_HISTORY, HER_MESSAGE);
    expect(r.focus).toBe('她');
    expect(r.staleTerms).toContain('妈妈');
    expect(r.directive).toContain('她');
    expect(r.directive).toContain('妈妈');
    expect(r.directive).toContain('不要出现');
    expect(r.directive).toContain('除非用户在本轮自己提到');
  });

  it('does not fire when the current message itself still mentions 「我妈」', () => {
    const r = resolveFocusEntity(MOM_HISTORY, '我妈这周末又安排了相亲，我该怎么拒绝？');
    expect(r.focus).toBe('我妈');
    expect(r.staleTerms).toEqual([]);
    expect(r.directive).toBe('');
  });

  it('returns no directive with empty history', () => {
    const r = resolveFocusEntity([], HER_MESSAGE);
    expect(r.focus).toBe('她');
    expect(r.staleTerms).toEqual([]);
    expect(r.directive).toBe('');
    expect(buildFocusDirective([], HER_MESSAGE)).toBe('');
  });

  it('returns null focus and no directive when the current message names nobody', () => {
    const r = resolveFocusEntity(MOM_HISTORY, '周末出门前要准备什么东西？');
    expect(r.focus).toBeNull();
    expect(r.directive).toBe('');
  });
});

describe('P233 · prompt assembly', () => {
  it('appends the constraint to the system prompt content', () => {
    const prompt =
      buildSystemPrompt({ name: '小林' }, 'auto') + buildFocusDirective(MOM_HISTORY, HER_MESSAGE);
    expect(prompt).toContain('本轮只讨论：她');
    expect(prompt).toContain('「妈妈」');
    expect(prompt).toContain('除非用户在本轮自己提到');
  });

  it('harness.ts wires buildFocusDirective into the run messages', () => {
    expect(harnessSrc).toContain('buildFocusDirective(');
    expect(harnessSrc).toContain('resolveFocusEntity');
    expect(harnessSrc).toContain('buildSystemPrompt(context.profile');
    expect(harnessSrc).toContain("role: 'system'");
  });
});
