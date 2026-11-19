/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P373 — at 1440×900 the intent chip strip sat flush on the bubble styled
 * as a filled light-green pill, so reviewers read 「排约会 ✓」 as a line
 * inside the reply. Two guarantees, asserted at source/CSS level (same
 * technique as bubble-actions-touch-targets.test.ts): the strip renders
 * before/outside the .bubble element, and .tool-badge inside .tool-events
 * has no filled background at rest with caption-size type.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const badgeCss = readFileSync(join(SRC, 'components', 'ToolBadge.css'), 'utf8');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

/** Concatenate the declaration bodies of every rule matching `selector`. */
function ruleBody(css: string, selector: string): string {
  const re = new RegExp(`${selector.replace(/\./g, '\\.')}[^{}]*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]).join('\n');
}

describe('P373 intent chip strip is UI feedback, not reply content', () => {
  it('the intent-chip block renders before the .bubble element', () => {
    const chipIndex = tsx.indexOf('data-role="intent-chip"');
    const bubbleIndex = tsx.indexOf('className={`bubble', chipIndex);
    expect(chipIndex, 'expected a data-role="intent-chip" block').toBeGreaterThan(-1);
    expect(bubbleIndex, 'expected the .bubble div').toBeGreaterThan(-1);
    expect(chipIndex).toBeLessThan(bubbleIndex);
  });

  it('.tool-badge inside .tool-events has no filled background at rest', () => {
    const body = ruleBody(badgeCss, '.tool-events .tool-badge');
    expect(body).toContain('background: transparent');
    expect(body).toContain('border-color: transparent');
    const size = body.match(/font-size:\s*(\d+)px/);
    expect(size, 'expected a font-size on .tool-events .tool-badge').toBeTruthy();
    expect(Number(size![1])).toBeLessThanOrEqual(12);
  });

  it('the .tool-events strip itself carries no bubble-like chrome', () => {
    const body = ruleBody(bubbleCss, '.tool-events');
    expect(body).toContain('background: transparent');
    expect(body).toMatch(/border:\s*none/);
  });
});
