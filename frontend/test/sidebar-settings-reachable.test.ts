/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Sidebar from '../src/components/Sidebar';

/**
 * P201 — at 390×844 the drawer scrolls (measured scrollHeight 993 /
 * clientHeight 844) and the 设置 gear sat at y≈899, fully past the scroll end
 * with no scroll affordance, so the settings entry was unreachable without
 * guessing. The drawer footer is now `position: sticky; bottom: 0` inside the
 * 768px media block: the button pins to the drawer viewport regardless of
 * scrollTop, and the opaque surface keeps scrolled content legible beneath.
 * Source-level assertions in the style of sidebar-drawer-inert.test.ts, plus
 * a static render to pin the button inside the footer.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

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

/** The stylesheet with every @media block removed — the desktop base rules. */
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

const tsx = read('components/Sidebar.tsx');
const css = read('components/Sidebar.css');
const mobile = mediaBlock(css, '(max-width: 768px)');

const noop = () => {};

function renderSidebar() {
  return renderToStaticMarkup(
    createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
  );
}

describe('P201 · settings entry stays reachable in the mobile drawer', () => {
  it('pins .sidebar-footer to the drawer bottom inside the 768px media block', () => {
    const body = ruleBody(mobile, '.sidebar.sidebar-drawer .sidebar-footer');
    expect(body).toContain('position: sticky');
    expect(body).toContain('bottom: 0');
  });

  it('gives the pinned footer an opaque surface so scrolled content stays legible', () => {
    const body = ruleBody(mobile, '.sidebar.sidebar-drawer .sidebar-footer');
    expect(body).toContain('background: var(--surface)');
    // The subtle top border separating pinned footer from scrolling content.
    expect(ruleBody(css, '.sidebar-footer')).toContain('border-top: 1px solid var(--border)');
  });

  it('keeps the drawer itself as the scroll container the footer sticks to', () => {
    expect(ruleBody(mobile, '.sidebar.sidebar-drawer')).toContain(
      'overflow-y: auto',
    );
  });

  it('leaves the desktop .sidebar-footer rule unpinned (≥769px unchanged)', () => {
    const base = ruleBody(stripMediaBlocks(css), '.sidebar-footer');
    expect(base).not.toContain('position: sticky');
    expect(base).not.toContain('position:sticky');
  });

  it('renders .settings-open-btn inside .sidebar-footer with accessible name 设置', () => {
    const footer = /<footer[\s\S]*?<\/footer>/.exec(tsx)?.[0] ?? '';
    expect(footer).toContain('className="sidebar-footer"');
    expect(footer).toContain('settings-open-btn');
    expect(footer).toContain('aria-label="设置"');
  });

  it('keeps the footer the last child of the scrolling <aside>', () => {
    // Sticky bottom:0 only pins to the viewport when nothing follows the
    // footer inside the scroll container.
    const tail = tsx.slice(tsx.indexOf('</footer>'));
    expect(tail.replace(/\s/g, '')).toMatch(/^<\/footer><\/aside>\)/);
  });

  it('renders the gear button inside the footer element in markup', () => {
    const html = renderSidebar();
    const footerStart = html.indexOf('<footer');
    const footerEnd = html.indexOf('</footer>');
    const btnAt = html.indexOf('settings-open-btn');
    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(btnAt).toBeGreaterThan(footerStart);
    expect(btnAt).toBeLessThan(footerEnd);
    expect(html).toContain('aria-label="设置"');
  });
});
