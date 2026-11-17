/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P259 — at a 390x844 viewport the settings path held the narrowest touch
 * targets on the site: the drawer's `.settings-open-btn` was 64x29, the
 * settings panel close `×` was 32x32, and every segmented option
 * (回复长度 / 语言 / 主题) was 34px tall — all under P227's >=36px rule.
 * The fix is pure CSS inside the existing `@media (max-width: 768px)`
 * blocks; these tests lock that contract at source level (no Playwright
 * in this repo). Desktop (>=769px) rules must stay untouched.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sidebarCss = readFileSync(join(SRC, 'components', 'Sidebar.css'), 'utf8');
const settingsCss = readFileSync(join(SRC, 'components', 'SettingsSheet.css'), 'utf8');
const chatWindowCss = readFileSync(join(SRC, 'components', 'ChatWindow.css'), 'utf8');

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
 *  concatenate the declarations (a selector may appear in a shared rule
 *  and again on its own). */
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

describe('P259 settings-path touch targets on narrow screens', () => {
  it('drawer .settings-open-btn is at least 36px tall', () => {
    const body = ruleBody(narrowBlock(sidebarCss), '.settings-open-btn');
    minHeightAtLeast36(body, '.settings-open-btn');
  });

  it('drawer .recent-chat-clear-all is at least 36px tall', () => {
    const body = ruleBody(narrowBlock(sidebarCss), '.recent-chat-clear-all');
    minHeightAtLeast36(body, '.recent-chat-clear-all');
  });

  it('settings panel .settings-close is at least 36x36', () => {
    const body = ruleBody(narrowBlock(settingsCss), '.settings-close');
    for (const prop of ['width', 'height']) {
      const m = body.match(new RegExp(`${prop}:\\s*(\\d+)px`));
      expect(m, `.settings-close ${prop} >= 36px`).toBeTruthy();
      expect(Number(m![1])).toBeGreaterThanOrEqual(36);
    }
  });

  it('every .settings-segment option is at least 36px tall', () => {
    const body = ruleBody(narrowBlock(settingsCss), '.settings-segment');
    minHeightAtLeast36(body, '.settings-segment');
  });

  it('profile-prompt dismiss .profile-nudge-dismiss is at least 36x36', () => {
    const body = ruleBody(narrowBlock(chatWindowCss), '.profile-nudge-dismiss');
    minHeightAtLeast36(body, '.profile-nudge-dismiss');
    const w = body.match(/min-width:\s*(\d+)px/);
    expect(w, '.profile-nudge-dismiss min-width >= 36px').toBeTruthy();
    expect(Number(w![1])).toBeGreaterThanOrEqual(36);
  });

  it('desktop rules are unchanged: base selectors keep their old sizes', () => {
    // .settings-close base rule stays 32x32 outside the media query.
    const baseClose = settingsCss.match(/\.settings-close\s*\{([^}]*)\}/);
    expect(baseClose).toBeTruthy();
    expect(baseClose![1]).toContain('width: 32px');
    expect(baseClose![1]).toContain('height: 32px');
    // base .settings-open-btn keeps padding-driven sizing (no min-height).
    const baseOpen = sidebarCss.match(/\.settings-open-btn\s*\{([^}]*)\}/);
    expect(baseOpen).toBeTruthy();
    expect(baseOpen![1]).not.toContain('min-height');
  });
});
