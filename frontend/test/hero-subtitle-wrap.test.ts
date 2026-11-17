/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P280 — at 390×844 the hero subtitle wrapped 「直接照着用」 mid-phrase as
 * 「直接照 / 着用」 (character-level rects: top 142 vs top 165). The fix keeps
 * the copy identical but wraps the fixed phrase in a nowrap span so the break
 * can only fall outside it, plus `text-wrap: balance` on the paragraph so the
 * break prefers a punctuation/phrase boundary. Source-level checks only —
 * no DOM renderer in this repo.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowTsx = readFileSync(join(SRC, 'components', 'ChatWindow.tsx'), 'utf8');
const chatWindowCss = readFileSync(join(SRC, 'components', 'ChatWindow.css'), 'utf8');

describe('P280 · hero subtitle nowrap phrase', () => {
  it('wraps 「直接照着用」 in a hero-subtitle-nowrap element', () => {
    expect(chatWindowTsx).toContain('className="hero-subtitle-nowrap"');
    const spanLine = chatWindowTsx
      .split('\n')
      .find((line) => line.includes('hero-subtitle-nowrap'));
    expect(spanLine).toBeDefined();
    expect(spanLine).toContain('直接照着用');
  });

  it('the CSS class carries white-space: nowrap', () => {
    const rule = chatWindowCss.match(
      /\.hero-subtitle-nowrap\s*\{[^}]*\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain('white-space: nowrap');
  });

  it('the nowrap is not applied to the paragraph or other ancestors', () => {
    const welcomeP = chatWindowCss.match(/\.welcome > p\s*\{[^}]*\}/);
    expect(welcomeP).not.toBeNull();
    expect(welcomeP![0]).not.toContain('nowrap');
  });

  it('the rendered copy text is unchanged', () => {
    // Strip JSX markup from the subtitle fragment and compare with the
    // original literal copy.
    const fragment = chatWindowTsx.match(
      /懂分寸的恋爱顾问[\s\S]*?的建议。/,
    );
    expect(fragment).not.toBeNull();
    const text = fragment![0]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '');
    expect(text).toBe(
      '懂分寸的恋爱顾问：先听你说完，再给一句能直接照着用的建议。',
    );
  });

  it('the paragraph balances its line breaks', () => {
    const welcomeP = chatWindowCss.match(/\.welcome > p\s*\{[^}]*\}/);
    expect(welcomeP![0]).toContain('text-wrap: balance');
  });
});
