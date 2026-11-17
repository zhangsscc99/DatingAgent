/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P263 — at a 390x844 viewport every `.bubble-row button` measured 25px tall
 * (复制我的消息 60x25, 复制回复 60x25, 重新生成回复 71x25): the last sub-36px
 * touch targets on the site after P227/P259/P260. The fix is pure CSS: one
 * new `@media (max-width: 768px)` block in MessageBubble.css that raises
 * .copy-btn / .regen-btn / .retry-btn (and .collapse-toggle) to
 * min-height >= 36px with inline-flex centering. These tests lock that
 * contract at source level (no DOM harness in this repo); the global rules
 * must keep their desktop padding/font-size untouched.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

/** Extract the body of one `@media (max-width: 768px) { ... }` block by
 *  counting braces, so nested rules are handled correctly. */
function narrowBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 768px)');
  expect(start, 'expected a max-width:768px media query').toBeGreaterThan(-1);
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

/** Find every `selector { ... }` inside an already-extracted block and
 *  concatenate the declarations. */
function ruleBody(block: string, selector: string): string {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  const matches = [...block.matchAll(re)];
  expect(matches.length, `expected ${selector} inside the narrow-screen media query`).toBeGreaterThan(0);
  return matches.map((m) => m[1]).join('\n');
}

function minHeightAtLeast36(body: string, selector: string) {
  const m = body.match(/min-height:\s*(\d+)px/);
  expect(m, `${selector} should declare min-height >= 36px`).toBeTruthy();
  expect(Number(m![1])).toBeGreaterThanOrEqual(36);
}

describe('P263 bubble action touch targets on narrow screens', () => {
  const narrow = narrowBlock(bubbleCss);

  for (const sel of ['.copy-btn', '.regen-btn', '.retry-btn']) {
    it(`${sel} is at least 36px tall inside the media query`, () => {
      const body = ruleBody(narrow, sel);
      minHeightAtLeast36(body, sel);
      expect(body).toContain('display: inline-flex');
      expect(body).toContain('align-items: center');
    });
  }

  it('.collapse-toggle is at least 36px tall inside the media query', () => {
    const body = ruleBody(narrow, '.collapse-toggle');
    minHeightAtLeast36(body, '.collapse-toggle');
    expect(body).toContain('display: inline-flex');
    expect(body).toContain('align-items: center');
  });

  it('desktop rules are unchanged: base .copy-btn / .regen-btn keep padding + font-size', () => {
    // The media block sits at the end of the file — drop it before matching
    // so only the global rules remain.
    const outsideMedia = bubbleCss.replace(narrowBlock(bubbleCss), '');
    const baseCopy = outsideMedia.match(/\.copy-btn\s*\{([^}]*)\}/);
    expect(baseCopy).toBeTruthy();
    expect(baseCopy![1]).toContain('padding: 3px 9px');
    expect(baseCopy![1]).toContain('font-size: 11px');
    expect(baseCopy![1]).not.toContain('min-height');

    const baseRegen = outsideMedia.match(/\.regen-btn\s*\{([^}]*)\}/);
    expect(baseRegen).toBeTruthy();
    expect(baseRegen![1]).toContain('padding: 3px 9px');
    expect(baseRegen![1]).toContain('font-size: 11px');
    expect(baseRegen![1]).not.toContain('min-height');
  });
});
