/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, type FakeDom, type FakeElement } from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P321 — measured at 390×844 on 1795003878 (docs/runs/walk-1795003878-m1.png):
 * the first screen showed four near-equal-weight entries — the「完善资料」
 * outline button, three starter chips, three tall feature cards and the
 * composer — so nothing read as the primary action, and the empty-composer
 * send key's #f0f0f5-on-white ghost fill (~1.1:1) read as disabled.
 *
 * Contract asserted here:
 *  1. Exactly ONE [data-primary-cta] on the empty screen — the composer's
 *     send key — and it is the only control carrying the brand solid fill.
 *  2. The welcome「完善资料」entry is demoted to a text link
 *     (data-variant="link"): no marker, no border/padding/fill chrome.
 *  3. The empty send key stays muted per P290 (surface-hover fill, no
 *     accent) but gains a --text-muted ring: ≥3:1 against the --surface
 *     composer bar in light/dark × desktop/mobile contexts.
 *  4. The three starter chips render in the `secondary` register.
 *  5. At a 390-wide render .welcome-features carries data-compact so the
 *     cards flatten to single-line rows; a wide render does not.
 *
 * Same fake-DOM harness as empty-state-chrome.test.ts: mount the real
 * ChatWindow with a width-driven matchMedia stub; CSS contracts are parsed
 * from the stylesheets the way message-actions.test.ts resolves tokens.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);
const inputBarCss = readFileSync(
  join(SRC, 'components', 'InputBar.css'),
  'utf8',
);
const indexCss = readFileSync(join(SRC, 'index.css'), 'utf8');

/* ---------- stylesheet resolution helpers (same as message-actions.test.ts) ---------- */

/** Concatenate the declaration bodies of every `selector { ... }` rule. */
function ruleBody(css: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...css.matchAll(re)].map((m) => m[1]).join('\n');
}

/** `--name: value;` declarations inside one `{ ... }` body. */
function cssVars(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/--[a-z-]+\s*:\s*([^;]+);/g)) {
    vars.set(m[0].split(':')[0].trim(), m[1].trim());
  }
  return vars;
}

/** A theme context = base vars with any <=768px overrides applied. */
function themeVars(
  baseBody: string,
  mobileBody: string | null,
): Map<string, string> {
  const vars = cssVars(baseBody);
  if (mobileBody) for (const [k, v] of cssVars(mobileBody)) vars.set(k, v);
  return vars;
}

function resolveColor(vars: Map<string, string>, declared: string): string {
  const varRef = /^var\((--[a-z-]+)\)$/.exec(declared.trim());
  const raw = varRef ? vars.get(varRef[1]) : declared.trim();
  expect(raw, `resolving ${declared}`).toBeTruthy();
  return raw!;
}

function declaredProperty(css: string, selector: string, prop: string): string {
  const body = ruleBody(css, selector);
  const m = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body);
  expect(m, `${selector} should declare ${prop}`).toBeTruthy();
  return m![1].trim();
}

/* ---------- WCAG contrast ---------- */

function channel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(m, `expected a #rrggbb color, got "${hex}"`).toBeTruthy();
  const n = parseInt(m![1], 16);
  return (
    0.2126 * channel(((n >> 16) & 255) / 255) +
    0.7152 * channel(((n >> 8) & 255) / 255) +
    0.0722 * channel((n & 255) / 255)
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The four contexts the composer can render in: light/dark x desktop/mobile. */
const LIGHT_BASE = (() => {
  const m = /:root\s*\{([^}]*)\}/.exec(indexCss);
  expect(m, ':root light block').toBeTruthy();
  return m![1];
})();
const LIGHT_MOBILE = (() => {
  const m = /@media \(max-width: 768px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(indexCss);
  return m ? m[1] : null;
})();
const DARK_BASE = (() => {
  const m = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(indexCss);
  expect(m, ':root[data-theme=dark] block').toBeTruthy();
  return m![1];
})();
const DARK_MOBILE = (() => {
  const m =
    /@media \(max-width: 768px\)\s*\{\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(
      indexCss,
    );
  return m ? m[1] : null;
})();

const CONTEXTS: Array<[string, Map<string, string>]> = [
  ['light', themeVars(LIGHT_BASE, null)],
  ['light @<=768px', themeVars(LIGHT_BASE, LIGHT_MOBILE)],
  ['dark', themeVars(DARK_BASE, null)],
  ['dark @<=768px', themeVars(DARK_BASE, DARK_MOBILE)],
];

/* ---------- mounted-DOM harness ---------- */

/** matchMedia stub resolving (min|max)-width queries against a fixed width. */
function mediaQueryForWidth(px: number) {
  return (q: string) => {
    const maxW = /max-width:\s*(\d+)px/.exec(q);
    const minW = /min-width:\s*(\d+)px/.exec(q);
    const matches =
      (maxW || minW) !== null &&
      (maxW ? px <= Number(maxW[1]) : true) &&
      (minW ? px >= Number(minW[1]) : true);
    return {
      matches,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

describe('P321 · one real primary CTA on the empty first screen', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mount = async (widthPx: number) => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(widthPx);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: [] as ChatMessage[],
          loading: false,
          onSend: () => {},
          onSetupProfile: () => {},
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const unmount = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('exactly one [data-primary-cta] renders, and it is the composer send key', async () => {
    await mount(390);
    const primaries = qsa('[data-primary-cta]');
    expect(primaries).toHaveLength(1);
    const send = primaries[0];
    expect(send.classList.contains('input-send')).toBe(true);
    expect(send.closest('.input-bar')).not.toBeNull();
    expect(send.getAttribute('aria-label')).toBe('发送消息');
    // The welcome column carries no primary marker of its own.
    const welcome = qs('.welcome');
    expect(welcome).not.toBeNull();
    expect(welcome!.querySelector('[data-primary-cta]')).toBeNull();
    await unmount();
  });

  it('the send key is the only brand-solid control on the first screen', () => {
    const send = ruleBody(inputBarCss, '.input-bar .input-send');
    expect(send).toContain('background: var(--accent)');
    // Every other empty-state control is demoted chrome — no accent fill.
    for (const sel of [
      ".welcome-cta[data-variant='link']",
      '.starter-chip',
      '.starter-chip.secondary',
    ]) {
      const rule = ruleBody(chatWindowCss, sel);
      expect(rule, sel).not.toBe('');
      expect(rule, sel).not.toContain('background: var(--accent)');
    }
  });

  it('the「完善资料」entry is a text link — no marker, no button chrome', async () => {
    await mount(390);
    const cta = qs('.welcome-cta');
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute('data-variant')).toBe('link');
    expect(cta!.hasAttribute('data-primary-cta')).toBe(false);
    expect(cta!.textContent).toContain('完善资料');
    await unmount();

    // Rendered chrome: no border, no padding box, no fill — text only.
    const link = ruleBody(chatWindowCss, ".welcome-cta[data-variant='link']");
    expect(link).not.toBe('');
    expect(link).toContain('border: none');
    expect(link).toContain('padding: 0');
    expect(link).toMatch(/background:\s*(none|transparent)/);
    expect(link).not.toContain('background: var(--accent)');
    // Small font, underline affordance — a link, not a button.
    expect(link).toContain('text-decoration: underline');
    const fontSize = /font-size:\s*(\d+)px/.exec(link);
    expect(fontSize).toBeTruthy();
    expect(Number(fontSize![1])).toBeLessThanOrEqual(13);
  });

  it('the three starter chips carry the secondary register, never a fill', async () => {
    await mount(390);
    const chips = qsa('.starter-chip');
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.classList.contains('secondary')).toBe(true);
      expect(chip.hasAttribute('data-primary-cta')).toBe(false);
    }
    await unmount();

    const rule = ruleBody(chatWindowCss, '.starter-chip');
    expect(rule).toContain('background: transparent');
    expect(rule).not.toContain('background: var(--accent)');
    expect(ruleBody(chatWindowCss, '.starter-chip.secondary')).toContain(
      'color: var(--text-secondary)',
    );
  });

  it('390-wide render: .welcome-features is marked data-compact with all three rows', async () => {
    await mount(390);
    const features = qs('.welcome-features');
    expect(features).not.toBeNull();
    expect(features!.getAttribute('data-compact')).toBe('true');
    expect(qsa('.feature')).toHaveLength(3);
    await unmount();
  });

  it('1440-wide render: no data-compact — the cards keep their tall form', async () => {
    await mount(1440);
    const features = qs('.welcome-features');
    expect(features).not.toBeNull();
    expect(features!.hasAttribute('data-compact')).toBe(false);
    expect(qsa('.feature')).toHaveLength(3);
    await unmount();
  });

  it('the compact rules flatten each card to a single quiet line', () => {
    const row = ruleBody(chatWindowCss, '.welcome-features[data-compact] .feature');
    expect(row).not.toBe('');
    expect(row).toContain('border: none');
    expect(row).toContain('background: transparent');
    // Icon + title + description share one flex line; the description
    // truncates instead of wrapping into a tall card body.
    const inner = ruleBody(
      chatWindowCss,
      '.welcome-features[data-compact] .feature > div',
    );
    expect(inner).toContain('display: flex');
    const desc = ruleBody(
      chatWindowCss,
      '.welcome-features[data-compact] .feature p',
    );
    expect(desc).toContain('white-space: nowrap');
    expect(desc).toContain('text-overflow: ellipsis');
  });
});

describe('P321 · the empty send key stays perceivable (>= 3:1)', () => {
  const body = ruleBody(inputBarCss, '.input-bar .input-send:disabled');

  it('keeps the P290 muted fill contract — no accent on the disabled key', () => {
    expect(body).toContain('background: var(--surface-hover)');
    expect(body).not.toContain('var(--accent)');
  });

  it('carries a visible ring whose colour clears 3:1 against the composer bar', () => {
    // The distinguishing edge of the empty send key is its border ring;
    // the composer bar behind it is .input-bar's --surface.
    const border = /border:\s*([^;]+)/.exec(body)?.[1] ?? '';
    const token = /var\(--[a-z-]+\)|#[0-9a-f]{3,8}/i.exec(border)?.[0];
    expect(token, 'disabled send should declare a solid border colour').toBeTruthy();
    const composerBg = declaredProperty(inputBarCss, '.input-bar', 'background');
    for (const [name, vars] of CONTEXTS) {
      const edge = resolveColor(vars, token!);
      const bg = resolveColor(vars, composerBg);
      const ratio = contrastRatio(edge, bg);
      expect(
        ratio,
        `${name}: empty send edge ${edge} on composer ${bg} → ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('the muted fill itself is unchanged — the ring does the work', () => {
    // Guard against a future "fix" that re-introduces a washed-out ghost
    // by fading the whole key: no opacity dimming on the disabled rule.
    expect(body).not.toMatch(/opacity\s*:\s*0?\.\d+/);
  });
});
