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
 * P218 — the bubble tool row still rendered the copy action as the glyph
 * 「⧉ 复制」 while P208 had already cleaned the header row to inline
 * currentColor SVGs. The fix swaps the ⧉ glyph inside MessageBubble's
 * copy-btn for the same 14 px currentColor SVG, keeping the accessible
 * name 「复制回复」, the click → copyText → copied feedback path and the
 * 「换一个」 sibling untouched. vitest runs in node (no DOM renderer),
 * so this pins the contract with a static render plus source guards.
 * P304 removed the user-bubble copy pill entirely, so the glyph contract
 * now applies to assistant bubbles only.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

const ASSISTANT: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  content: '可以回得开心但不过度激动。',
  createdAt: 1,
};

const USER: ChatMessage = {
  id: 'u-1',
  role: 'user',
  content: '她今天答应周末出来了',
  createdAt: 1,
};

const copyButtonMarkup = (message: ChatMessage) => {
  const html = renderToStaticMarkup(createElement(MessageBubble, { message }));
  const at = html.indexOf('copy-btn');
  expect(at, 'copy button').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</button>', at));
};

describe('P218 · bubble copy button has no ⧉ glyph', () => {
  it('the copy button source no longer contains the ⧉ character', () => {
    const btnStart = tsx.indexOf('className={`copy-btn');
    expect(btnStart).toBeGreaterThan(-1);
    const block = tsx.slice(btnStart, tsx.indexOf('</button>', btnStart));
    expect(block).not.toContain('⧉');
    expect(block).not.toMatch(EMOJI);
  });

  it('idle copy button renders an inline currentColor SVG + 复制 text', () => {
    const markup = copyButtonMarkup(ASSISTANT);
    expect(markup).not.toContain('⧉');
    expect(markup).not.toMatch(EMOJI);
    expect(markup).toContain('<svg');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('复制');
  });

  it('user bubbles render no copy button at all (P304)', () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, { message: USER }));
    expect(html).not.toContain('copy-btn');
    expect(html).not.toContain('复制');
  });

  it('the accessible name is still 复制回复', () => {
    const markup = copyButtonMarkup(ASSISTANT);
    expect(markup).toContain('aria-label="复制回复"');
    expect(markup).toContain('title="复制回复"');
  });

  it('click still runs the copy handler and the copied state still renders', () => {
    // The button wires onClick to handleCopy, which calls copyText and
    // flips copyState to 'copied'/'failed' with the 1.5 s reset timer.
    const btnStart = tsx.indexOf('className={`copy-btn');
    const block = tsx.slice(btnStart, tsx.indexOf('</button>', btnStart));
    expect(block).toContain('onClick={handleCopy}');
    expect(block).toContain("'已复制'");
    expect(block).toContain("'复制失败'");
    const handlerStart = tsx.indexOf('const handleCopy');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = tsx.slice(handlerStart, tsx.indexOf('}, [', handlerStart));
    expect(handler).toContain('copyText(bodyText)');
    expect(handler).toContain("setCopyState(ok ? 'copied' : 'failed')");
    expect(tsx).toContain('const COPY_FEEDBACK_MS = 1500');
    // The aria-live status line that announces the copied state stays put.
    expect(tsx).toContain('className="copy-status"');
    expect(tsx).toContain('已复制到剪贴板');
  });

  it('the 「换一个」 sibling and the actions-row guard are unchanged', () => {
    expect(tsx).toContain('{(canCopy || canRegen) && (');
    expect(tsx).toContain('className="regen-btn"');
    expect(tsx).toContain("{'换一个'}");
    expect(tsx).toContain('aria-label="重新生成回复"');
  });
});
