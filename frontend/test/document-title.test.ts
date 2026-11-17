/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P246 — closed as not-a-product-bug: the 🐴 in the tab title was injected
 * by the review browser itself (an unrelated plain-HTML probe and even
 * Chromium's own error page showed the same prefix, while `curl` and
 * `git log -S"🐴" -- frontend/index.html` both prove the shipped markup was
 * always clean). This source-level test is the regression net: if an emoji
 * ever really lands in <title> the suite fails here.
 */

const INDEX_HTML = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.html',
);

describe('P246 · index.html <title> stays emoji-free', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];

  it('has a <title> element', () => {
    expect(title).toBeTruthy();
  });

  it('is exactly the product title with no emoji code point', () => {
    expect(title).toBe('DatingAgent — AI 恋爱关系顾问');
    expect(title).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
