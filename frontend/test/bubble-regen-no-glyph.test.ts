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
 * P222 — the bubble tool row still rendered the regenerate action as the
 * glyph 「↻ 换一个」 while P218 had already swapped the neighbouring copy
 * button to a 14 px inline currentColor SVG, so the two buttons on the
 * same flex row mixed a text glyph with an icon. The fix mirrors the copy
 * button's markup: a 14 px currentColor rotate SVG (aria-hidden) plus the
 * 「换一个」 label, keeping aria-label 「重新生成回复」, the
 * onClick → handleRegenerate → onRegenerate(message.id) path and the
 * disabled-while-busy behaviour untouched. vitest runs in node (no DOM
 * renderer), so this pins the contract with a static render plus source
 * guards.
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

const regenButtonMarkup = (message: ChatMessage) => {
  const html = renderToStaticMarkup(
    createElement(MessageBubble, { message, onRegenerate: () => {} }),
  );
  const at = html.indexOf('regen-btn');
  expect(at, 'regen button').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</button>', at));
};

describe('P222 · bubble regen button has no ↻ glyph', () => {
  it('the regen button source no longer contains the ↻ character', () => {
    const btnStart = tsx.indexOf('className="regen-btn"');
    expect(btnStart).toBeGreaterThan(-1);
    const block = tsx.slice(btnStart, tsx.indexOf('</button>', btnStart));
    expect(block).not.toContain('↻');
    expect(block).not.toMatch(EMOJI);
  });

  it('regen button renders an inline currentColor SVG + 换一个 text', () => {
    const markup = regenButtonMarkup(ASSISTANT);
    expect(markup).not.toContain('↻');
    expect(markup).not.toMatch(EMOJI);
    expect(markup).toContain('<svg');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('换一个');
  });

  it('the accessible name is still 重新生成回复', () => {
    const markup = regenButtonMarkup(ASSISTANT);
    expect(markup).toContain('aria-label="重新生成回复"');
    expect(markup).toContain('title="换一个回复"');
  });

  it('click still runs the regenerate handler with the message id', () => {
    // The button wires onClick to handleRegenerate, which forwards
    // message.id to the onRegenerate prop; busy still disables it (P335
    // adds the roll-cap flag to the same expression).
    const btnStart = tsx.indexOf('className="regen-btn"');
    const block = tsx.slice(btnStart, tsx.indexOf('</button>', btnStart));
    expect(block).toContain('onClick={handleRegenerate}');
    expect(block).toContain('disabled={busy || regenCapped || !canRegen}');
    const handlerStart = tsx.indexOf('const handleRegenerate');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = tsx.slice(handlerStart, tsx.indexOf('}, [', handlerStart));
    expect(handler).toContain('onRegenerate?.(message.id)');
  });

  it('the copy sibling and the actions-row guard are unchanged', () => {
    expect(tsx).toContain('{(canCopy || showRegenButton) && (');
    expect(tsx).toContain('className={`copy-btn');
    expect(tsx).toContain("'复制回复'");
  });
});
