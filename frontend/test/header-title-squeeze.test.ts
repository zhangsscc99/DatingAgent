/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P274 — at 360px/320px the brand block and the reply-language select were
 * flush against each other (title right edge === .lang-select left edge, gap
 * 0px at 1cfeb03), so any longer localised title or larger font would paint
 * the two over each other. The hardening keeps a guaranteed ≥8px gap between
 * the two header groups (column-gap on .header), lets the brand text shrink
 * via a min-width:0 chain (.header-left → .header-title → .header-title-text)
 * and truncates the h1 with an ellipsis instead of overflowing — without any
 * fixed width and without changing the 1440px desktop look. Source-level
 * assertions only (no Playwright in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appTsx = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const appCss = readFileSync(join(SRC, 'App.css'), 'utf8');

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

const baseCss = stripMediaBlocks(appCss);

describe('P274 · header title squeeze hardening', () => {
  it('the title text node is wrapped in a shrinkable .header-title-text', () => {
    expect(appTsx).toContain('className="header-title-text"');
    const wrap = appTsx.indexOf('className="header-title-text"');
    const h1 = appTsx.indexOf('<h1>', wrap);
    expect(h1).toBeGreaterThan(wrap);
    // The wrapper sits inside .header-title.
    expect(appTsx.lastIndexOf('className="header-title"', wrap)).toBeGreaterThan(-1);
    expect(appTsx.lastIndexOf('className="header-title"', wrap)).toBeLessThan(wrap);
  });

  it('the header row guarantees a ≥8px gap between the two groups', () => {
    const header = ruleBody(baseCss, '.header');
    const gap = /column-gap:\s*(\d+)px/.exec(header) ?? /gap:\s*(\d+)px/.exec(header);
    expect(gap, '.header must declare an explicit column-gap').not.toBeNull();
    expect(Number(gap![1])).toBeGreaterThanOrEqual(8);
  });

  it('the truncation contract: min-width:0 chain plus ellipsis on the h1', () => {
    for (const sel of ['.header-left', '.header-title', '.header-title-text']) {
      expect(ruleBody(baseCss, sel), sel).toContain('min-width: 0');
    }
    expect(ruleBody(baseCss, '.header-title-text')).toContain('overflow: hidden');
    const h1 = ruleBody(baseCss, '.header h1');
    expect(h1).toContain('white-space: nowrap');
    expect(h1).toContain('overflow: hidden');
    expect(h1).toContain('text-overflow: ellipsis');
  });

  it('no fixed width on the brand block that could force overlap', () => {
    for (const sel of ['.header-title', '.header-title-text', '.header h1']) {
      const body = ruleBody(baseCss, sel);
      // Any explicit width/min-width must be 0 — a nonzero fixed width on the
      // brand block would force it under the language select again.
      const decl = /(?<![-\w])(min-)?width:\s*([^;]+)/.exec(body);
      if (decl) expect(decl[2].trim(), sel).toBe('0');
    }
    // The header row never wraps onto a second line.
    expect(ruleBody(baseCss, '.header')).not.toContain('flex-wrap: wrap');
  });

  it('the language select still shrinks last: it keeps flex-shrink: 0', () => {
    expect(ruleBody(baseCss, '.lang-select')).toContain('flex-shrink: 0');
    expect(ruleBody(baseCss, '.header-actions')).toContain('flex-shrink: 0');
  });

  it('desktop rules are untouched: no truncation added inside the 768px block', () => {
    // The ellipsis contract lives in the base rules and only clips on real
    // overflow; the ≤768px block must not pin the title to a fixed width or
    // hide it outright.
    const mediaStart = appCss.indexOf('@media (max-width: 768px)');
    expect(mediaStart).toBeGreaterThan(-1);
    const nextMedia = appCss.indexOf('@media', mediaStart + 10);
    const block = appCss.slice(mediaStart, nextMedia === -1 ? undefined : nextMedia);
    expect(block).not.toMatch(/\.header-title[^{]*\{[^}]*width:/);
    expect(block).not.toMatch(/\.header-title[^{]*\{[^}]*display:\s*none/);
    // .header keeps its single-row flex layout — the block only tweaks padding.
    const narrowHeader = ruleBody(block, '.header');
    expect(narrowHeader).not.toContain('flex-wrap');
    expect(narrowHeader).not.toContain('column-gap');
  });
});
