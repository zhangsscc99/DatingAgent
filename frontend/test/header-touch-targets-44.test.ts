/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P441 — at a 390×844 viewport the three icon buttons `.sidebar-close-btn`,
 * `.theme-btn` and `.more-menu-trigger` all measured 36×36px, under the
 * 44px touch-target floor (WCAG 2.5.8 / Apple HIG). The fix is pure CSS:
 * each button's hit area grows to ≥44×44 below the 768px breakpoint, the
 * visible icon stays the same size. These tests lock that contract at
 * source level (no layout engine in the fake DOM): inside
 * `@media (max-width: 768px)` every one of the three selectors must resolve
 * to a width AND height ≥44px, matching the live
 * `getBoundingClientRect()` check at 390×844.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appCss = read('App.css');
const sidebarCss = read(join('components', 'Sidebar.css'));

/** Slice the body of one `@media <query> { ... }` block by brace counting. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  expect(start, `expected a ${query} media query`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('unclosed media query');
}

/** Concatenate declarations of every rule inside `block` whose selector
 *  list contains `selector`. */
function ruleBody(block: string, selector: string): string {
  const css = block.replace(/\/\*[^]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let body = '';
  for (const m of css.matchAll(re)) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (sels.includes(selector)) body += `${m[2]}\n`;
  }
  expect(body, `expected ${selector} inside the media query`).not.toBe('');
  return body;
}

function atLeast44(body: string, selector: string, prop: 'width' | 'height') {
  const m = body.match(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  expect(m, `${selector} should declare ${prop} >= 44px`).toBeTruthy();
  expect(Number(m![1]), `${selector} ${prop}`).toBeGreaterThanOrEqual(44);
}

describe('P441 header icon-button touch targets at 390px', () => {
  const appNarrow = mediaBlock(appCss, '(max-width: 768px)');
  const sidebarNarrow = mediaBlock(sidebarCss, '(max-width: 768px)');

  for (const sel of ['.theme-btn', '.more-menu-trigger']) {
    it(`${sel} is at least 44×44 inside the narrow-screen media query`, () => {
      const body = ruleBody(appNarrow, sel);
      atLeast44(body, sel, 'width');
      atLeast44(body, sel, 'height');
    });
  }

  it('.sidebar-close-btn is at least 44×44 inside the drawer media query', () => {
    const body = ruleBody(sidebarNarrow, '.sidebar-close-btn');
    atLeast44(body, '.sidebar-close-btn', 'width');
    atLeast44(body, '.sidebar-close-btn', 'height');
    expect(body).toContain('display: flex');
    expect(body).toContain('align-items: center');
  });
});
