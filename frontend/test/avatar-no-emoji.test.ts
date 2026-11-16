/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P202 — header brand and assistant avatar are emoji-free. vitest runs in
 * the node environment (same as welcome-no-emoji.test.ts), so these source
 * guards lock the rendered markup: index.html's <title> (what the browser
 * puts into document.title), the .logo brand mark in App.tsx and the
 * .avatar node in MessageBubble.tsx carry no Extended_Pictographic code
 * points. Emoji inside the user's own message text stay untouched — this
 * only covers our own chrome decoration.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(FRONTEND, 'src');
const readSrc = (file: string) => readFileSync(join(SRC, file), 'utf8');

const indexHtml = readFileSync(join(FRONTEND, 'index.html'), 'utf8');
const app = readSrc('App.tsx');
const appCss = readSrc('App.css');
const bubble = readSrc('components/MessageBubble.tsx');
const bubbleCss = readSrc('components/MessageBubble.css');
const EMOJI = /\p{Extended_Pictographic}/u;

const logoBlock = app.match(/<span className="logo"[\s\S]*?<\/span>/)?.[0] ?? '';
const avatarBlock =
  bubble.match(/<div className="avatar"[\s\S]*?<\/div>/)?.[0] ?? '';
const avatarCss =
  bubbleCss.match(/\.avatar\s*\{[^}]*\}/)?.[0] ?? '';
const logoCss = appCss.match(/\.logo\s*\{[^}]*\}/)?.[0] ?? '';

describe('P202 · document title, header brand and assistant avatar are emoji-free', () => {
  it('index.html <title> carries no emoji code points', () => {
    const title = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    expect(title).toContain('DatingAgent');
    expect(EMOJI.test(title)).toBe(false);
    // no dynamic title assignment may reintroduce one
    const assignments = app.match(/document\.title\s*=[^;]+/g) ?? [];
    for (const a of assignments) expect(EMOJI.test(a)).toBe(false);
  });

  it('the header brand mark renders an inline SVG, not an emoji', () => {
    expect(logoBlock.length).toBeGreaterThan(0);
    expect(EMOJI.test(logoBlock)).toBe(false);
    expect(logoBlock).toContain('<svg');
    expect(logoBlock).toContain('stroke="currentColor"');
    expect(logoBlock).toContain('aria-hidden="true"');
    // same 20–28 px slot the emoji glyph occupied
    expect(logoBlock).toContain('width="28"');
    expect(logoBlock).toContain('height="28"');
    expect(logoCss.length).toBeGreaterThan(0);
  });

  it('the assistant avatar node renders no pictographic character', () => {
    expect(avatarBlock.length).toBeGreaterThan(0);
    expect(EMOJI.test(avatarBlock)).toBe(false);
    expect(avatarBlock).toContain('aria-hidden="true"');
    expect(avatarBlock).toContain('<svg');
    // the 32 px circle box must not move
    expect(avatarCss).toContain('width: 32px');
    expect(avatarCss).toContain('height: 32px');
    expect(avatarCss).toContain('border-radius: 50%');
  });

  it('user message text is never routed through the markdown/table normaliser', () => {
    expect(bubble).toContain(
      'isUser ? message.content : normalizeMarkdownTables(message.content)',
    );
  });
});
