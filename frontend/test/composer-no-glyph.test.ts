/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import InputBar from '../src/components/InputBar';

/**
 * P221 — the composer tool row still rendered its last two glyph-only
 * controls: the shortcut-help button read 「⌨」 and the send button read
 * 「↑」, so a first-time user could not tell they meant 快捷键说明 and
 * 发送. The fix swaps both glyphs for 16 px currentColor inline SVGs (the
 * same P199/P208/P218 style): a keyboard icon for the shortcut button and
 * a paper-plane for send. aria-labels, click behaviour, the
 * reply-length-toggle position and the single-row layout are unchanged.
 * vitest runs in node, so the contract is pinned with static markup plus
 * source guards.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

const noop = () => {};

const html = renderToStaticMarkup(
  createElement(InputBar, {
    onSend: noop,
    replyLength: 'default' as const,
    onReplyLengthChange: noop,
  }),
);

/** Slice one rendered <button …>…</button> by a marker inside its tag. */
const buttonMarkup = (marker: string) => {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', at);
  const close = html.indexOf('</button>', at);
  expect(open, `${marker} open tag`).toBeGreaterThan(-1);
  expect(close, `${marker} close tag`).toBeGreaterThan(open);
  return html.slice(open, close);
};

/** Slice a <button …>…</button> block in the tsx source by a marker. */
const sourceButton = (marker: string) => {
  const at = tsx.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = tsx.lastIndexOf('<button', at);
  const close = tsx.indexOf('</button>', at);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return tsx.slice(open, close);
};

describe('P221 · composer tool-row buttons carry no glyph text', () => {
  it('the shortcut-help button renders no ⌨ glyph — an inline SVG instead', () => {
    const btn = buttonMarkup('input-hint-btn');
    expect(btn).not.toContain('⌨');
    expect(btn).not.toContain('↑');
    expect(btn).not.toMatch(EMOJI);
    expect(btn).toContain('<svg');
    expect(btn).toContain('stroke="currentColor"');
    expect(btn).toContain('aria-hidden="true"');
  });

  it('the send button renders no ↑ glyph — an inline SVG instead', () => {
    // 'class="input-send"' is exact — the stop button is 'input-send
    // input-stop', and it only renders while streaming (not in this markup).
    const btn = buttonMarkup('class="input-send"');
    expect(btn).not.toContain('↑');
    expect(btn).not.toContain('⌨');
    expect(btn).not.toMatch(EMOJI);
    expect(btn).toContain('<svg');
    expect(btn).toContain('stroke="currentColor"');
    expect(btn).toContain('aria-hidden="true"');
  });

  it('the source buttons no longer contain the glyphs either', () => {
    expect(sourceButton('className="input-hint-btn"')).not.toContain('⌨');
    expect(sourceButton('className="input-send"')).not.toContain('↑');
  });

  it('accessible names are unchanged: 键盘快捷键说明 / 发送消息', () => {
    expect(buttonMarkup('input-hint-btn')).toContain(
      'aria-label="键盘快捷键说明"',
    );
    expect(buttonMarkup('class="input-send"')).toContain(
      'aria-label="发送消息"',
    );
  });

  it('behaviour wiring is untouched: send still calls submit, hint still owns the tooltip', () => {
    const send = sourceButton('className="input-send"');
    expect(send).toContain('onClick={submit}');
    expect(send).toContain('disabled={sendBlocked || !text.trim()}');
    const hint = sourceButton('className="input-hint-btn"');
    expect(hint).toContain('aria-describedby="input-kbd-tip"');
    // The tooltip itself (with its kbd ↑/↓ 历史消息 row) stays put — only
    // the button glyphs were replaced.
    expect(tsx).toContain('id="input-kbd-tip"');
    expect(tsx).toContain('role="tooltip"');
    // DOM order is unchanged: length toggle → hint → send → stop.
    expect(tsx.indexOf('reply-length-toggle')).toBeLessThan(
      tsx.indexOf('input-hint-btn'),
    );
    expect(tsx.indexOf('input-hint-btn')).toBeLessThan(
      tsx.indexOf('className="input-send"'),
    );
    expect(tsx.indexOf('className="input-send"')).toBeLessThan(
      tsx.indexOf('input-send input-stop'),
    );
  });

  it('both buttons are flex-centred so the SVG sits like the old glyph did', () => {
    const css = readFileSync(join(SRC, 'components', 'InputBar.css'), 'utf8');
    for (const sel of ['.input-bar .input-send', '.input-hint-btn']) {
      const block = css.slice(
        css.indexOf(`${sel} {`),
        css.indexOf('}', css.indexOf(`${sel} {`)),
      );
      expect(block).toContain('display: flex');
      expect(block).toContain('align-items: center');
      expect(block).toContain('justify-content: center');
    }
  });
});
