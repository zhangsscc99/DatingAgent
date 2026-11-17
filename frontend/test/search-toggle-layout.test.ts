/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P206 — at 1440×900 the floating `.search-toggle` (a 36×36 round button,
 * position:absolute; z-index:10 inside `.messages-wrap`) physically
 * overlapped the first user bubble and clipped its last characters. P206
 * moved the ≥1024px trigger into the header action row; P226 finished the
 * job below 1024px, where the same floating button covered the first bubble
 * at 390×844 too. The trigger (`.search-toggle-header`, same aria-label/
 * title, same open handler) now lives in the header at every width and the
 * floating button is gone entirely. Source-level assertions plus a static
 * render — this repo has no DOM test runner for styles.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appTsx = read('App.tsx');
const appCss = read('App.css');
const chatTsx = read('components/ChatWindow.tsx');
/** Comments stripped — the explanatory comment still names .search-toggle. */
const chatCss = read('components/ChatWindow.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Slice the body of `@media <query> { … }` with brace matching. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return '';
}

/** The stylesheet with every @media block removed — the base rules. */
function stripMediaBlocks(css: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = css.indexOf('@media', cursor);
    if (start < 0) return out + css.slice(cursor);
    out += css.slice(cursor, start);
    const openBrace = css.indexOf('{', start);
    let depth = 0;
    let end = css.length;
    for (let i = openBrace; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    cursor = end;
  }
}

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

const MESSAGES: ChatMessage[] = [
  { id: 'u-1', role: 'user', content: '她今天答应周末出来了', createdAt: 1 },
];

describe('P206/P226 · search toggle layout', () => {
  it('renders the search trigger inside .header-actions at every width', () => {
    const start = appTsx.indexOf('className="header-actions"');
    expect(start).toBeGreaterThan(-1);
    const headerActions = appTsx.slice(start, appTsx.indexOf('</header>', start));
    expect(headerActions).toContain('className="search-toggle-header"');
    // Same accessible name and tooltip the floating toggle carried.
    const btnAt = headerActions.indexOf('search-toggle-header');
    const button = headerActions.slice(
      btnAt,
      headerActions.indexOf('</button>', btnAt),
    );
    expect(button).toContain('aria-label={FIND_IN_CONVERSATION_LABEL}');
    expect(button).toContain('title={FIND_IN_CONVERSATION_LABEL}');
    // P199/P202/P208 standard: inline currentColor SVG, decoration aria-hidden,
    // no emoji glyph.
    expect(button).toContain('<svg');
    expect(button).toContain('stroke="currentColor"');
    expect(button).toContain('aria-hidden="true"');
    expect(button).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('the header trigger is visible at every width — ≥36px below 1024px, compact 32px on desktop', () => {
    const base = ruleBody(stripMediaBlocks(appCss), '.search-toggle-header');
    // Not a hidden-by-default rule anymore: inline-flex in the base keeps it
    // reachable on mobile and desktop alike.
    expect(base).toMatch(/display:\s*inline-flex/);
    expect(base).not.toMatch(/display:\s*none/);
    // ≥36×36 touch target below 1024px (the base size).
    expect(base).toContain('width: 36px');
    expect(base).toContain('height: 36px');
    // The ≥1024px block only shrinks it back to the desktop's 32×32 — it
    // must not hide it again.
    const desktop = mediaBlock(appCss, '(min-width: 1024px)');
    expect(desktop).toMatch(/\.search-toggle-header\s*\{[^}]*width:\s*32px/);
    expect(desktop).toMatch(/\.search-toggle-header\s*\{[^}]*height:\s*32px/);
    expect(ruleBody(desktop, '.search-toggle-header')).not.toMatch(
      /display:\s*none/,
    );
  });

  it('no floating .search-toggle remains in ChatWindow markup or CSS', () => {
    expect(chatTsx).not.toContain('className="search-toggle"');
    // No .search-toggle selector survives anywhere in the stylesheet —
    // `.search-toggle-header` lives in App.css and must not match this.
    expect(chatCss).not.toMatch(/\.search-toggle[\s,{:]/);
  });

  it('renders no search toggle inside .messages-wrap', () => {
    const html = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: MESSAGES,
        loading: false,
        onSend: () => {},
      }),
    );
    const wrapAt = html.indexOf('messages-wrap');
    expect(wrapAt).toBeGreaterThanOrEqual(0);
    // Nothing classed search-toggle anywhere in the chat window render.
    expect(html).not.toContain('search-toggle');
  });

  it('the header trigger calls the same search-open handler ChatWindow exposes', () => {
    // ChatWindow exposes openSearch on a handle; App wires the header
    // button to it at every breakpoint.
    const handlerAt = chatTsx.indexOf('const openSearch');
    expect(handlerAt).toBeGreaterThan(-1);
    const handler = chatTsx.slice(handlerAt, handlerAt + 300);
    expect(handler).toContain('setSearchOpen(true)');
    expect(chatTsx).toContain('useImperativeHandle');
    expect(chatTsx).toContain('openSearch');
    expect(appTsx).toContain('useRef<ChatWindowHandle>(null)');
    expect(appTsx).toContain('chatWindowRef.current?.openSearch()');
    expect(appTsx).toContain('ref={chatWindowRef}');
  });
});
