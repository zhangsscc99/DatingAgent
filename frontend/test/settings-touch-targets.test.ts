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

  it('profile suggestion is one <=32px capsule on narrow screens (P349)', () => {
    const body = ruleBody(narrowBlock(chatWindowCss), '.profile-nudge');
    const maxH = body.match(/max-height:\s*(\d+)px/);
    expect(maxH, '.profile-nudge must cap its height').toBeTruthy();
    expect(Number(maxH![1])).toBeLessThanOrEqual(32);
    const h = body.match(/height:\s*(\d+)px/);
    expect(h, '.profile-nudge must pin its height').toBeTruthy();
    expect(Number(h![1])).toBeLessThanOrEqual(32);
  });

  it('the capsule label keeps a 44px hit area and the dismiss × stays inside the 32px capsule', () => {
    const btn = ruleBody(narrowBlock(chatWindowCss), '.profile-nudge-btn');
    // P444 supersedes P349's flush label: the visual capsule stays 32px but
    // the button's tap zone is stretched to the 44px touch-target floor.
    expect(btn).toContain('min-height: 44px');
    expect(btn).toContain('display: inline-flex');
    expect(btn).toContain('align-items: center');
    const dismiss = ruleBody(narrowBlock(chatWindowCss), '.profile-nudge-dismiss');
    expect(dismiss).toContain('min-height: 0');
    const h = dismiss.match(/height:\s*(\d+)px/);
    expect(h).toBeTruthy();
    expect(Number(h![1])).toBeLessThanOrEqual(32);
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
    // base .profile-nudge-btn is the capsule label: still 12px type inside
    // the 32px pill (P349), with P444's 44px hit-area floor on the button.
    const outsideMedia = chatWindowCss.replace(narrowBlock(chatWindowCss), '');
    const baseNudge = outsideMedia.match(/\.profile-nudge-btn\s*\{([^}]*)\}/);
    expect(baseNudge).toBeTruthy();
    expect(baseNudge![1]).toContain('padding: 0 4px');
    expect(baseNudge![1]).toContain('font-size: 12px');
    expect(baseNudge![1]).toContain('min-height: 44px');
    // …and the capsule itself never exceeds P349's 32px ceiling.
    const baseCapsule = outsideMedia.match(/\.profile-nudge\s*\{([^}]*)\}/);
    expect(baseCapsule).toBeTruthy();
    const capsuleMax = baseCapsule![1].match(/max-height:\s*(\d+)px/);
    expect(capsuleMax).toBeTruthy();
    expect(Number(capsuleMax![1])).toBeLessThanOrEqual(32);
  });
});
