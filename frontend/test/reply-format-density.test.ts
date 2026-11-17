/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import type { ChatMessage } from '../src/types';

/**
 * P235 — a 「看展前要准备什么」 question used to render as a numbered manual:
 * h3 sub-headings plus a full-width blockquote for every one-line sample
 * phrase. The fix pairs a SYSTEM_PROMPT rule (≤3 short paragraphs, ≤3
 * bullets, no h3/##/blockquote) with a render-layer downgrade: a blockquote
 * holding exactly one paragraph with no line break renders as a normal
 * paragraph with the inline-quote style, while multi-line quotes keep the
 * blockquote rendering.
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(TEST_DIR, '..', 'src');
const bubbleTsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');
const harnessSrc = readFileSync(
  join(TEST_DIR, '..', '..', 'backend', 'src', 'agent', 'harness.ts'),
  'utf8',
);

const msg = (partial: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  ...partial,
});

const render = (m: ChatMessage) =>
  renderToStaticMarkup(createElement(MessageBubble, { message: m }));

describe('P235 · preparation-question density rule + blockquote downgrade', () => {
  it('SYSTEM_PROMPT carries the 准备/清单类 rule key sentences', () => {
    const start = harnessSrc.indexOf('const SYSTEM_PROMPT');
    const end = harnessSrc.indexOf('`;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const promptSource = harnessSrc.slice(start, end);
    expect(promptSource).toContain('要准备什么');
    expect(promptSource).toContain('最多 3 个短段落');
    expect(promptSource).toContain('最多 3 条要点');
    expect(promptSource).toContain('不设 h3 编号小标题');
    expect(promptSource).toContain('用户明确要求「详细」或「完整清单」时不受此限');
  });

  it('the render layer has a single-line blockquote downgrade branch', () => {
    expect(bubbleTsx).toContain('components={markdownComponents}');
    expect(bubbleTsx).toContain('singleLineQuoteParagraph');
    expect(bubbleTsx).toContain('inline-quote');
    // The non-downgrade path still renders a real blockquote.
    expect(bubbleTsx).toContain('<blockquote>{children}</blockquote>');
  });

  it('a single-line `> …` renders as a styled paragraph, not a blockquote', () => {
    const html = render(msg({ content: '> 那周末我提前看一下展的入场信息' }));
    expect(html).toContain('inline-quote');
    expect(html).toContain('那周末我提前看一下展的入场信息');
    expect(html).not.toContain('<blockquote');
  });

  it('multi-line blockquotes keep the blockquote rendering', () => {
    const softBreak = render(msg({ content: '> 第一行\n> 第二行' }));
    expect(softBreak).toContain('<blockquote>');
    expect(softBreak).not.toContain('inline-quote');
    const twoParagraphs = render(msg({ content: '> 段一\n>\n> 段二' }));
    expect(twoParagraphs).toContain('<blockquote>');
    expect(twoParagraphs).not.toContain('inline-quote');
  });

  it('the inline-quote style lives in the bubble stylesheet', () => {
    expect(bubbleCss).toContain('.inline-quote');
    expect(bubbleCss).toContain('var(--text-muted)');
  });
});
