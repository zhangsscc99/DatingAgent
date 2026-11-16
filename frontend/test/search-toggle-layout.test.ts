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
 * overlapped the first user bubble and clipped its last characters, while
 * the desktop sidebar already carries a persistent 筛选对话 input. The fix:
 * below 1024px the floating button is untouched; at ≥1024px it is
 * `display:none` and an identical trigger (`.search-toggle-header`, same
 * aria-label/title, same open handler) sits in the header action row with
 * the export/copy buttons. Source-level assertions plus a static render —
 * this repo has no DOM test runner.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appTsx = read('App.tsx');
const appCss = read('App.css');
const chatTsx = read('components/ChatWindow.tsx');
const chatCss = read('components/ChatWindow.css');

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

describe('P206 · search toggle layout', () => {
  it('keeps the floating .search-toggle as the <1024px entry, unchanged', () => {
    // Still rendered inside .messages-wrap with the original wiring.
    const wrapStart = chatTsx.indexOf('className="messages-wrap"');
    expect(wrapStart).toBeGreaterThan(-1);
    const toggleAt = chatTsx.indexOf('className="search-toggle"');
    expect(toggleAt).toBeGreaterThan(wrapStart);
    // Its base rule keeps the absolute positioning — no desktop-only change
    // leaked into the mobile presentation.
    const base = ruleBody(stripMediaBlocks(chatCss), '.search-toggle');
    expect(base).toContain('position: absolute');
    expect(base).not.toMatch(/display:\s*none/);
    // The button still carries the original accessible name and tooltip.
    const toggleMarkup = chatTsx.slice(
      toggleAt,
      chatTsx.indexOf('</button>', toggleAt),
    );
    expect(toggleMarkup).toContain('aria-label="搜索对话"');
    expect(toggleMarkup).toContain('title="搜索当前对话"');
  });

  it('hides the floating .search-toggle at ≥1024px', () => {
    const desktop = mediaBlock(chatCss, '(min-width: 1024px)');
    expect(desktop).toMatch(/\.search-toggle\s*\{[^}]*display:\s*none/);
  });

  it('renders a desktop replacement inside .header-actions', () => {
    const start = appTsx.indexOf('className="header-actions"');
    expect(start).toBeGreaterThan(-1);
    const headerActions = appTsx.slice(start, appTsx.indexOf('</header>', start));
    expect(headerActions).toContain('className="search-toggle-header"');
    // Same accessible name and tooltip as the floating toggle.
    const btnAt = headerActions.indexOf('search-toggle-header');
    const button = headerActions.slice(
      btnAt,
      headerActions.indexOf('</button>', btnAt),
    );
    expect(button).toContain('aria-label="搜索对话"');
    expect(button).toContain('title="搜索当前对话"');
    // P199/P202/P208 standard: inline currentColor SVG, decoration aria-hidden,
    // no emoji glyph.
    expect(button).toContain('<svg');
    expect(button).toContain('stroke="currentColor"');
    expect(button).toContain('aria-hidden="true"');
    expect(button).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('shows the header trigger only at ≥1024px', () => {
    const base = ruleBody(stripMediaBlocks(appCss), '.search-toggle-header');
    expect(base).toMatch(/display:\s*none/);
    const desktop = mediaBlock(appCss, '(min-width: 1024px)');
    expect(desktop).toMatch(
      /\.search-toggle-header\s*\{[^}]*display:\s*inline-flex/,
    );
  });

  it('both triggers call the same search-open handler', () => {
    // The floating toggle delegates to a shared handler…
    const toggleAt = chatTsx.indexOf('className="search-toggle"');
    const toggleMarkup = chatTsx.slice(
      toggleAt,
      chatTsx.indexOf('</button>', toggleAt),
    );
    expect(toggleMarkup).toContain('onClick={openSearch}');
    // …which opens the in-conversation search the old inline handler did.
    const handlerAt = chatTsx.indexOf('const openSearch');
    expect(handlerAt).toBeGreaterThan(-1);
    const handler = chatTsx.slice(handlerAt, handlerAt + 300);
    expect(handler).toContain('setSearchOpen(true)');
    // ChatWindow exposes it on a handle, and App wires the header button to it.
    expect(chatTsx).toContain('useImperativeHandle');
    expect(chatTsx).toContain('openSearch');
    expect(appTsx).toContain('useRef<ChatWindowHandle>(null)');
    expect(appTsx).toContain('chatWindowRef.current?.openSearch()');
    expect(appTsx).toContain('ref={chatWindowRef}');
  });

  it('renders the floating toggle inside .messages-wrap in markup (mobile path intact)', () => {
    const html = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: MESSAGES,
        loading: false,
        onSend: () => {},
      }),
    );
    const wrapAt = html.indexOf('messages-wrap');
    const toggleAt = html.indexOf('search-toggle');
    expect(wrapAt).toBeGreaterThanOrEqual(0);
    expect(toggleAt).toBeGreaterThan(wrapAt);
    expect(html).toContain('aria-label="搜索对话"');
  });
});
