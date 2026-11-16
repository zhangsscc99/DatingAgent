/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P163 — at phone width the closed drawer was only `translateX(-100%)`: still
 * rendered, still tabbable, and `aria-hidden` with focusable descendants. The
 * <aside> now carries `inert` while `isMobile && !open`, and the CSS hides the
 * closed state with `visibility: hidden` that flips at the end of the slide.
 * Source-level assertions, same style as a11y.test.ts (no DOM deps).
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

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

const tsx = read('components/Sidebar.tsx');
const css = read('components/Sidebar.css');
const aside = /<aside[\s\S]*?>/.exec(tsx)?.[0] ?? '';
const mobile = mediaBlock(css, '(max-width: 768px)');

describe('P163 · closed mobile drawer is unreachable by Tab', () => {
  it('binds inert on the <aside> gated on the closed mobile state', () => {
    const inert = /\binert=\{([^}]*)\}/.exec(aside);
    expect(inert).not.toBeNull();
    expect(inert![1]).toContain('isMobile');
    expect(inert![1]).toContain('!open');
  });

  it('keeps the aria-hidden / dialog wiring untouched', () => {
    expect(aside).toContain('aria-hidden={isMobile ? !open : undefined}');
    expect(aside).toContain("role={isMobile ? 'dialog' : undefined}");
    expect(aside).toContain('aria-modal={isMobile ? open : undefined}');
  });

  it('hides the closed drawer and reveals it while open', () => {
    expect(ruleBody(mobile, '.sidebar.sidebar-drawer')).toContain(
      'visibility: hidden',
    );
    expect(ruleBody(mobile, '.sidebar.sidebar-drawer.open')).toContain(
      'visibility: visible',
    );
  });

  it('switches visibility at the correct end of the slide transition', () => {
    const closed = ruleBody(mobile, '.sidebar.sidebar-drawer');
    expect(closed).toContain('transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(closed).toContain('visibility 0s linear 0.28s');

    const open = ruleBody(mobile, '.sidebar.sidebar-drawer.open');
    expect(open).toContain('transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(open).toContain('visibility 0s');
    expect(open).not.toContain('linear 0.28s');
  });

  it('drops the visibility delay under prefers-reduced-motion', () => {
    const reduced = mediaBlock(css, '(prefers-reduced-motion: reduce)');
    const body = ruleBody(reduced, '.sidebar.sidebar-drawer');
    expect(body).not.toBe('');
    expect(body).not.toContain('0.28s');
  });
});
