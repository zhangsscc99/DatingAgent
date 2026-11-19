/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  COARSE_POINTER_QUERY,
  HERO_HINT_KEYBOARD,
  HERO_HINT_TOUCH,
  heroHint,
} from '../src/lib/heroHint';
import ChatWindow from '../src/components/ChatWindow';

/**
 * P350 — measured at 390×844 with `isMobile: true, hasTouch: true`: the clean
 * first screen still said 「在下方输入框写下你的情况，回车发送即可开始。」 while
 * the only send affordance on a touch phone is the paper-plane key beside the
 * composer. The hint must describe the action the device actually has.
 *
 * Contract asserted here:
 *  1. The touch copy never mentions 回车 and still names the send action.
 *  2. The keyboard copy keeps the exact pre-P350 sentence (desktop unchanged).
 *  3. Both variants live in one module — ChatWindow imports them instead of
 *     hard-coding either string.
 *  4. The rendered desktop hero hint still carries 「回车发送」.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowTsx = readFileSync(
  join(SRC, 'components', 'ChatWindow.tsx'),
  'utf8',
);

describe('P350 · first-screen send hint matches the device', () => {
  it('touch copy drops 回车 and names the send action', () => {
    expect(HERO_HINT_TOUCH).not.toMatch(/回车/);
    expect(HERO_HINT_TOUCH).toContain('发送');
    expect(HERO_HINT_TOUCH).toContain('在下方输入框写下你的情况');
  });

  it('keyboard copy is byte-identical to the pre-P350 sentence', () => {
    expect(HERO_HINT_KEYBOARD).toBe(
      '在下方输入框写下你的情况，回车发送即可开始。',
    );
    expect(HERO_HINT_KEYBOARD).toContain('回车发送');
  });

  it('picks the touch copy on coarse pointers or narrow viewports', () => {
    expect(heroHint({ coarsePointer: true, narrowViewport: false })).toBe(
      HERO_HINT_TOUCH,
    );
    expect(heroHint({ coarsePointer: false, narrowViewport: true })).toBe(
      HERO_HINT_TOUCH,
    );
    expect(heroHint({ coarsePointer: true, narrowViewport: true })).toBe(
      HERO_HINT_TOUCH,
    );
  });

  it('keeps the keyboard copy on a fine-pointer desktop', () => {
    expect(heroHint({ coarsePointer: false, narrowViewport: false })).toBe(
      HERO_HINT_KEYBOARD,
    );
    expect(COARSE_POINTER_QUERY).toBe('(pointer: coarse)');
  });

  it('ChatWindow reads the hint from the shared module, not a literal', () => {
    expect(chatWindowTsx).toContain('heroHint(');
    expect(chatWindowTsx).toContain('COARSE_POINTER_QUERY');
    expect(chatWindowTsx).toContain('<p className="welcome-hint">{startHint}</p>');
    // The raw copy must live only in lib/heroHint.ts.
    expect(chatWindowTsx).not.toContain('回车发送即可开始');
    expect(chatWindowTsx).not.toContain('点发送即可开始');
  });

  it('server-rendered hero (no window → fine pointer) keeps 回车发送', () => {
    const html = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: [],
        loading: false,
        onSend: () => {},
      }),
    );
    expect(html).toContain('welcome-hint');
    expect(html).toContain('回车发送');
  });
});
