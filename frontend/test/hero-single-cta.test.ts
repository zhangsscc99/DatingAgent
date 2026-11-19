/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act, Fragment } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeEvent,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import Sidebar from '../src/components/Sidebar';
import { STARTER_ENTRIES } from '../src/lib/starterEntries';
import { HERO_PRIMARY_LABEL } from '../src/lib/heroCta';
import type { ChatMessage } from '../src/types';

/**
 * P336 — measured at 390×844 on 1795029110 (docs/runs/walk-1795029110-m1.png):
 * the P321 test passed while the rendered first screen still showed four
 * near-equal visual weights — the「完善资料」text link, three starter
 * chips, three feature cards and the composer — and the empty send key
 * still read as a disabled grey ghost. Class-counting assertions had
 * covered markers, not the visual contract.
 *
 * Contract asserted here:
 *  1. At 390×844, scrollTop=0, the rendered focusable controls among
 *     `button, a[href], [role="button"]` inside the visible viewport
 *     number ≤ 4 — after P343 the chips are a non-interactive hint line
 *     and the「完善资料」footnote a role="link" span, so the send key is
 *     the only such control inside ChatWindow (the disabled empty send
 *     key is not focusable; the keyboard shortcut hint and the length
 *     cycler are not rendered on the narrow spotlighted screen).
 *  2. Exactly ONE control carries the brand solid fill — the composer
 *     send key ([data-primary-cta]). P380: the EMPTY send key now reads
 *     disabled instead — neutral fill + dimmed opacity — because the
 *     hero's primary button owns the first screen's one solid control.
 *  3. The ENABLED send key's fill clears ≥3:1 contrast against its
 *     composer background — both the plain --surface bar and the P336
 *     spotlight tint (--accent-soft over --surface) — in light and dark.
 *  4. At 390 wide the three feature cards do not render. P380: they do
 *     not render at ≥769px either — the explanation cards were the
 *     removable half of the desktop's 7 competing entries.
 *  5. The「完善资料」entry is `data-variant="link"` chrome — the welcome
 *     block's last element — carrying no border/fill/padding box.
 *
 * Same fake-DOM harness as before: mount the real ChatWindow with a
 * width-driven matchMedia stub; CSS contracts are parsed from the real
 * stylesheets the way message-actions.test.ts resolves tokens.
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

/** The viewport this contract is measured against. */
const VIEWPORT_W = 390;
const VIEWPORT_H = 844;

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

function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(m, `expected a #rrggbb color, got "${hex}"`).toBeTruthy();
  const n = parseInt(m![1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba(r, g, b, a)` composited over an opaque hex base → hex. */
function compositeOver(declared: string, baseHex: string): string {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    declared.trim(),
  );
  if (!m) return declared;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const [br, bg, bb] = hexRgb(baseHex);
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(mix(Number(m[1]), br))}${to2(mix(Number(m[2]), bg))}${to2(
    mix(Number(m[3]), bb),
  )}`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  return (
    0.2126 * channel(r / 255) +
    0.7152 * channel(g / 255) +
    0.0722 * channel(b / 255)
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
    /@media \(max-width: 768px\)\s*\{\s*:root\[data-theme='dark'\]\s*:\s*\{?/.test(
      indexCss,
    )
      ? /@media \(max-width: 768px\)\s*\{\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(
          indexCss,
        )
      : null;
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

/** A control the user can actually reach: not disabled, not tabbed out,
 *  not inside an sr-only live region. */
function isFocusable(el: FakeElement): boolean {
  if (el.disabled) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.closest('.sr-only')) return false;
  return true;
}

/** Inside the first screen: scrollTop = 0, so a rect is in view while its
 *  top edge sits above VIEWPORT_H and its bottom edge below 0. The fake
 *  DOM reports zero rects, which lands every mounted node "in view" —
 *  the render-level contract is therefore about what mounts at all. */
function inFirstViewport(el: FakeElement): boolean {
  const r = el.getBoundingClientRect();
  return r.top < VIEWPORT_H && r.bottom >= 0;
}

describe('P336 · one real primary CTA on the empty first screen (390×844)', () => {
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

  it('the first viewport holds ≤4 rendered focusable controls', async () => {
    await mount(VIEWPORT_W);
    const controls = qsa('button, a[href], [role="button"]').filter(
      (el) => isFocusable(el) && inFirstViewport(el),
    );
    const labels = controls.map(
      (el) => el.getAttribute('aria-label') ?? el.textContent.trim(),
    );
    expect(
      controls.length,
      `first-screen controls: ${labels.join(' | ')}`,
    ).toBeLessThanOrEqual(4);
    // P343: the starter chips demoted to a single muted, non-interactive
    // hint line — the labels survive as plain text. P355: the line is
    // generated from the same STARTER_ENTRIES the drawer renders.
    const line = qs('.starter-chips-line');
    expect(line).not.toBeNull();
    expect(line!.tagName).toBe('P');
    expect(line!.querySelector('button, a[href], [role="button"]')).toBeNull();
    for (const entry of STARTER_ENTRIES) {
      expect(line!.textContent).toContain(entry.label);
    }
    expect(qsa('.starter-chip')).toHaveLength(0);
    // …and the「完善资料」entry stays a working footer-level link — a
    // role="link" span, outside the button/a[href] pool.
    const cta = qs('.welcome-cta');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('SPAN');
    expect(cta!.getAttribute('role')).toBe('link');
    expect(cta!.textContent).toContain('完善资料');
    // The keyboard-shortcut hint documents physical keys — it does not
    // mount on a ≤430px phone; the length cycler leaves the spotlighted
    // composer too (P343).
    expect(qs('.input-hint-btn')).toBeNull();
    expect(qs('.reply-length-toggle')).toBeNull();
    await unmount();
  });

  it('exactly one [data-primary-cta] renders — the composer send key', async () => {
    await mount(VIEWPORT_W);
    const primaries = qsa('[data-primary-cta]');
    expect(primaries).toHaveLength(1);
    const send = primaries[0];
    expect(send.classList.contains('input-send')).toBe(true);
    expect(send.closest('.input-bar')).not.toBeNull();
    expect(send.getAttribute('aria-label')).toBe('发送消息');
    const welcome = qs('.welcome');
    expect(welcome).not.toBeNull();
    expect(welcome!.querySelector('[data-primary-cta]')).toBeNull();
    await unmount();
  });

  it('the enabled send key keeps its brand solid; empty-disabled drops to neutral (P380)', () => {
    // Enabled keeps the one solid fill…
    const enabled = ruleBody(inputBarCss, '.input-bar .input-send');
    expect(enabled).toContain('background: var(--accent)');
    expect(enabled).toContain('color: var(--on-accent)');
    // …but P380 gives the empty-disabled key a real disabled visual:
    // neutral surface fill + muted ink + not-allowed — the hero button
    // now owns the first screen's only solid accent control.
    const disabled = ruleBody(inputBarCss, '.input-bar .input-send:disabled');
    expect(disabled).not.toBe('');
    expect(disabled).toContain('background: var(--surface-hover)');
    expect(disabled).toContain('color: var(--text-muted)');
    expect(disabled).toContain('cursor: not-allowed');
    expect(disabled).not.toContain('var(--accent)');
    // P374/P380: the hero's one real primary button is the only OTHER
    // element allowed the brand solid — and it is the only clickable one
    // while the empty send key sits disabled.
    const heroRule = ruleBody(chatWindowCss, '.hero-cta-primary');
    expect(heroRule).toContain('background: var(--accent)');
    expect(heroRule).toContain('color: var(--on-accent)');
    // Nothing else on the empty screen wears the accent fill.
    for (const sel of [
      ".welcome-cta[data-variant='link']",
      '.starter-chip',
      '.starter-chip.secondary',
      '.starter-pill',
      '.hero-cta-card',
    ]) {
      const rule = ruleBody(chatWindowCss, sel);
      expect(rule, sel).not.toBe('');
      expect(rule, sel).not.toContain('background: var(--accent)');
    }
  });

  it('the composer wears the spotlight tint on the empty narrow screen', async () => {
    await mount(VIEWPORT_W);
    const bar = qs('.input-bar');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('data-spotlight')).toBe('true');
    await unmount();
    const rule = ruleBody(inputBarCss, '.input-bar[data-spotlight]');
    expect(rule).toContain('background: var(--accent-soft)');

    // The treatment is narrow-only: a wide render keeps the plain bar.
    await mount(1440);
    expect(qs('.input-bar')!.hasAttribute('data-spotlight')).toBe(false);
    await unmount();
  });

  it('the「完善资料」entry is a footnote link at the block foot — no chrome', async () => {
    await mount(VIEWPORT_W);
    const cta = qs('.welcome-cta');
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute('data-variant')).toBe('link');
    expect(cta!.hasAttribute('data-primary-cta')).toBe(false);
    expect(cta!.textContent).toContain('完善资料');
    // Foot of the welcome block: it follows the hero actions and the
    // starter pills — a footnote, not a control in the main flow.
    const welcome = qs('.welcome')!;
    const order = welcome.children.map((el) => el.className);
    const ctaIndex = order.findIndex((c) => c.includes('welcome-cta'));
    const chipsIndex = order.findIndex((c) => c.includes('starter-chips'));
    const heroIndex = order.findIndex((c) => c.includes('hero-cta'));
    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(chipsIndex).toBeGreaterThan(heroIndex);
    expect(ctaIndex).toBeGreaterThan(chipsIndex);
    await unmount();

    // Rendered chrome: no border, no padding box, no fill — text only.
    const link = ruleBody(chatWindowCss, ".welcome-cta[data-variant='link']");
    expect(link).not.toBe('');
    expect(link).toContain('border: none');
    expect(link).toContain('padding: 0');
    expect(link).toMatch(/background:\s*(none|transparent)/);
    expect(link).not.toContain('background: var(--accent)');
    const fontSize = /font-size:\s*(\d+)px/.exec(link);
    expect(fontSize).toBeTruthy();
    expect(Number(fontSize![1])).toBeLessThanOrEqual(13);
    expect(link).toContain('color: var(--text-muted)');
  });

  it('390-wide render: the feature cards and their summary line stay off', async () => {
    await mount(VIEWPORT_W);
    expect(qsa('.feature')).toHaveLength(0);
    // P374: the muted summary line is gone too — the first screen's
    // auxiliary-copy budget is two muted lines, already spent on the
    // subtitle and the starter pills.
    expect(qs('.welcome-feature-line')).toBeNull();
    expect(qsa('.feature')).toHaveLength(0);
    await unmount();
  });

  it('1440-wide render: the three explanation cards are gone (P380)', async () => {
    await mount(1440);
    // P380: the passive cards were the removable half of the desktop's
    // 7 competing entries — the shared hero CTA leads instead.
    expect(qsa('.feature')).toHaveLength(0);
    expect(qs('.welcome-feature-line')).toBeNull();
    await unmount();
  });
});

describe('P336 · the ENABLED send key clears >=3:1 against its composer background', () => {
  it('accent fill vs the plain --surface bar and the spotlight tint', () => {
    // P380: the contrast contract now measures the ENABLED send key —
    // the disabled state intentionally falls below it (it must read
    // disabled), asserted in the next test.
    const sendFill = declaredProperty(
      inputBarCss,
      '.input-bar .input-send',
      'background',
    );
    const barBg = declaredProperty(inputBarCss, '.input-bar', 'background');
    const spotBg = declaredProperty(
      inputBarCss,
      '.input-bar[data-spotlight]',
      'background',
    );
    for (const [name, vars] of CONTEXTS) {
      const fill = compositeOver(resolveColor(vars, sendFill), '#ffffff');
      const surface = resolveColor(vars, barBg);
      const spot = compositeOver(resolveColor(vars, spotBg), surface);
      for (const [bgName, bg] of [
        ['plain bar', surface],
        ['spotlight tint', spot],
      ] as const) {
        const ratio = contrastRatio(fill, bg);
        expect(
          ratio,
          `${name} · ${bgName}: send ${fill} on ${bg} → ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('the empty-disabled fill deliberately drops below 3:1 — it must read disabled (P380)', () => {
    const disabledFill = declaredProperty(
      inputBarCss,
      '.input-bar .input-send:disabled',
      'background',
    );
    const barBg = declaredProperty(inputBarCss, '.input-bar', 'background');
    const accent = declaredProperty(inputBarCss, '.input-bar .input-send', 'background');
    expect(disabledFill).not.toBe(accent);
    for (const [name, vars] of CONTEXTS) {
      const fill = compositeOver(resolveColor(vars, disabledFill), '#ffffff');
      const surface = resolveColor(vars, barBg);
      const ratio = contrastRatio(fill, surface);
      expect(
        ratio,
        `${name}: disabled ${fill} on ${surface} → ${ratio.toFixed(2)}:1`,
      ).toBeLessThan(3);
    }
  });

  it('the tinted bar still reads as a tint — softer than the key itself', () => {
    const spot = declaredProperty(
      inputBarCss,
      '.input-bar[data-spotlight]',
      'background',
    );
    expect(spot).toBe('var(--accent-soft)');
    // The tint is a translucent wash, not a second solid: it composites
    // toward the surface, never toward full accent strength.
    for (const [name, vars] of CONTEXTS) {
      const surface = resolveColor(vars, 'var(--surface)');
      const tinted = compositeOver(resolveColor(vars, spot), surface);
      const accent = resolveColor(vars, 'var(--accent)');
      expect(tinted, name).not.toBe(accent);
    }
  });
});

/**
 * P342/P344 — the desktop edition of the same defect, measured at
 * 1440×900 (docs/runs/walk-1795033913-d1.png, walk-1795041074-d1.png):
 * the sidebar's dashed「完善资料，获得更个性化建议」card and the welcome
 * block's same-copy footnote link rendered at once — two entries for one
 * action — while the 600 px content column sat inside the ~1180 px main
 * area leaving a dead right-side void.
 *
 * Contract asserted here:
 *  1. At 1440 the mounted sidebar + welcome screen holds exactly ONE
 *     focusable control whose label contains「完善资料」— the welcome
 *     footnote link. The sidebar card is not rendered at ≥769px at all
 *     (non-render, so the column reflows with no hole); below the
 *     breakpoint the drawer keeps it — mobile is unchanged.
 *  2. The empty-state column — `.welcome`/`hero`, the `.messages`
 *     content column and the composer's `.input-column` (textarea) — all
 *     resolve to the shared --column-max (600–680 px; P391 narrowed it
 *     to 660 px so an assistant line holds ≤42 CJK glyphs), so the
 *     textarea stays the first screen's single obvious focal point and
 *     the widths match within the ≤8 px tolerance.
 *  3. The column is centred by symmetric auto margins on every strip —
 *     the block's right gap equals its left gap (Δ 0 ≤ 10% of 1440).
 */
describe('P342 · one 「完善资料」 entry and a widened column at 1440×900', () => {
  const DESKTOP_W = 1440;
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  /** The real first screen: persistent aside + empty ChatWindow. */
  const mountScreen = async (widthPx: number) => {
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
        createElement(
          Fragment,
          null,
          createElement(Sidebar, {
            tools: [],
            onQuickPrompt: () => {},
            onNewChat: () => {},
            onEditProfile: () => {},
          }),
          createElement(ChatWindow, {
            messages: [] as ChatMessage[],
            loading: false,
            onSend: () => {},
            onSetupProfile: () => {},
          }),
        ),
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

  /** Resolve a `max-width:` declaration to px — a literal, or
   *  var(--name[, fallback]) followed to its px declaration in index.css. */
  function resolveMaxWidthPx(css: string, selector: string): number | null {
    const decl = /max-width:\s*([^;]+)/.exec(ruleBody(css, selector))?.[1];
    if (!decl) return null;
    const text = decl.trim();
    const px = /^([0-9.]+)px$/.exec(text);
    if (px) return parseFloat(px[1]);
    const varRef = /^var\((--[\w-]+)\s*(?:,\s*([^()]+))?\)$/.exec(text);
    if (!varRef) return null;
    const hit = new RegExp(
      `${varRef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([0-9.]+)px`,
    ).exec(indexCss);
    if (hit) return parseFloat(hit[1]);
    const fallback = varRef[2] && /^([0-9.]+)px$/.exec(varRef[2].trim());
    return fallback ? parseFloat(fallback[1]) : null;
  }

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('exactly ONE focusable「完善资料」control renders across sidebar + main', async () => {
    await mountScreen(DESKTOP_W);
    const controls = qsa('button, a[href], [role="button"]').filter(
      (el) => isFocusable(el) && inFirstViewport(el),
    );
    const entries = controls.filter((el) =>
      (el.getAttribute('aria-label') ?? el.textContent).includes('完善资料'),
    );
    expect(
      entries.length,
      `「完善资料」controls: ${entries
        .map((el) => `${el.className}:${el.textContent}`)
        .join(' | ')}`,
    ).toBe(1);
    // …and the survivor is the welcome block's footnote link.
    expect(entries[0].classList.contains('welcome-cta')).toBe(true);
    // The sidebar's dashed card is not mounted at all — not hidden, not
    // inert: the column reflows with no hole where it used to sit.
    expect(qs('.profile-setup-btn')).toBeNull();
    expect(qs('.profile-card')).toBeNull();
    await unmount();
  });

  it('the mobile drawer keeps its「完善资料」card (no regression)', async () => {
    await mountScreen(VIEWPORT_W);
    const card = qs('.profile-setup-btn');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('完善资料');
    await unmount();
  });

  it('the welcome column shares --column-max and the composer/messages columns match ≤8px', () => {
    const welcome = resolveMaxWidthPx(chatWindowCss, '.welcome');
    const messages = resolveMaxWidthPx(chatWindowCss, '.messages > *');
    const composer = resolveMaxWidthPx(inputBarCss, '.input-column');
    expect(welcome).not.toBeNull();
    // .hero rides .welcome — the widened empty-state column, now capped
    // by P391's ≤680 px reading column.
    expect(welcome!).toBeGreaterThanOrEqual(600);
    expect(welcome!).toBeLessThanOrEqual(680);
    expect(messages).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(messages!).toBeGreaterThanOrEqual(600);
    expect(messages!).toBeLessThanOrEqual(680);
    expect(composer!).toBeGreaterThanOrEqual(600);
    expect(composer!).toBeLessThanOrEqual(680);
    // P344: textarea width vs the .messages content column — both resolve
    // the shared --column-max, Δ 0.
    expect(Math.abs(composer! - messages!)).toBeLessThanOrEqual(8);
  });

  it('the centred column leaves equal left/right gaps (Δ ≤ 10% viewport)', () => {
    // Symmetric auto margins centre each strip's shared column inside the
    // same content box, so the right void equals the left one: Δ = 0.
    for (const [css, sel] of [
      [chatWindowCss, '.messages > *'],
      [chatWindowCss, '.welcome'],
      [inputBarCss, '.input-column'],
    ] as const) {
      const body = ruleBody(css, sel);
      const centred =
        /(?:^|;)\s*margin\s*:\s*auto/.test(body) ||
        (/margin-left\s*:\s*auto/.test(body) &&
          /margin-right\s*:\s*auto/.test(body));
      expect(centred, `${sel} must keep symmetric auto margins`).toBe(true);
    }
  });
});

/**
 * P374 — measured at 390×844 on 1795090365 (docs/runs/walk-1795090365-m1.png,
 * the P367 fix's 7th recurrence): the hero's data-testid="hero-primary-cta"
 * was a 334×174 DIV of three equal-weight cards labelled 「点一条，直接发送」
 * — clicking it sent a canned question while `document.activeElement.id`
 * stayed "". Four near-equal clickables and four-plus lines of auxiliary
 * gray copy competed on the first screen, and the ·-joined 「也可以直接问」
 * hint broke mid-phrase at 390px.
 *
 * Contract asserted here (the backlog's verify clause):
 *  1. At 390×844 at most ONE clickable first-screen candidate that is
 *     ≥44×44 AND wears a brand-color background or border renders — and
 *     it is `<button data-testid="hero-primary-cta">说说你的情况</button>`,
 *     whose click focuses #chat-input and dispatches no chat send.
 *  2. First-screen auxiliary gray copy is ≤2 muted text lines total.
 *  3. No text node overflows its container (scrollWidth <= clientWidth)
 *     at 390 width — the starter hint is a wrap-safe row of independent
 *     nowrap pills, so nothing breaks mid-phrase.
 *
 * The fake DOM reports zero rects, so "in view" and "≥44×44" are evaluated
 * the way the other hero tests do: the render-level expressions a
 * real-layout run evaluates, plus the resolved CSS constants.
 */
describe('P374 · one obvious primary action on the mobile first screen', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mount = async (widthPx: number, onSend: (t: string) => void = () => {}) => {
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
          onSend,
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

  /** Every resting-state declaration body that could paint `el` — each
   *  rule whose selector's trailing compound (pseudo-states stripped)
   *  matches the element. Combinator prefixes are approximated away,
   *  which is the same resolution style the other hero tests use. */
  function chromeRules(el: FakeElement): string {
    const bodies: string[] = [];
    const css = `${chatWindowCss}\n${inputBarCss}`;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selText = m[1];
      if (selText.includes('@')) continue;
      for (const part of selText.split(',')) {
        const compound = part.trim().split(/[\s>+~]+/).pop() ?? '';
        const resting = compound.replace(
          /:{1,2}[a-zA-Z-]+(?:\([^)]*\))?/g,
          '',
        );
        if (resting && el.matches(resting)) bodies.push(m[2]);
      }
    }
    return bodies.join('\n');
  }

  function firstPx(rule: string, prop: string): number {
    const m = new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`).exec(rule);
    return m ? Number(m[1]) : 0;
  }

  /** A "primary candidate" per the verify clause: a clickable element
   *  whose resolved box reaches the 44px floor on both axes. */
  function isLargeCandidate(el: FakeElement): boolean {
    const rules = chromeRules(el);
    const h = firstPx(rules, 'min-height') || firstPx(rules, 'height');
    const w = /(?:^|;)\s*width\s*:\s*100%/.test(rules)
      ? 44
      : firstPx(rules, 'width') || firstPx(rules, 'min-width');
    return h >= 44 && w >= 44;
  }

  /** Brand chrome = resting background or border painted var(--accent)
   *  (accent-soft/-glow tints do not match `var(--accent)` exactly). */
  function hasBrandChrome(el: FakeElement): boolean {
    const rules = chromeRules(el);
    return (
      /background(?:-color)?\s*:[^;]*var\(--accent\)/.test(rules) ||
      /border(?:-[a-z-]*)?\s*:[^;]*var\(--accent\)/.test(rules)
    );
  }

  it('at most one clickable ≥44×44 first-screen candidate wears brand chrome — the hero button', async () => {
    await mount(VIEWPORT_W);
    const candidates = qsa('button, a[href], [role="button"], [role="link"]')
      .filter((el) => isFocusable(el) && inFirstViewport(el))
      .filter(isLargeCandidate);
    const branded = candidates.filter(hasBrandChrome);
    expect(
      branded.length,
      `brand-chrome candidates: ${branded
        .map((el) => `${el.className}:${el.textContent.trim()}`)
        .join(' | ')}`,
    ).toBeLessThanOrEqual(1);
    expect(branded).toHaveLength(1);
    expect(branded[0].getAttribute('data-testid')).toBe('hero-primary-cta');
    // Why the count holds: the empty send key keeps its accent fill but
    // sits disabled — not clickable — while every secondary control
    // resolves neutral chrome only.
    const send = qs('.input-send')!;
    expect(send.disabled).toBe(true);
    for (const card of qsa('.hero-cta-card')) {
      expect(hasBrandChrome(card)).toBe(false);
      expect(isLargeCandidate(card)).toBe(true);
    }
    await unmount();
  });

  it('hero-primary-cta is a real button; its click focuses #chat-input and sends nothing', async () => {
    const sent: string[] = [];
    await mount(VIEWPORT_W, (t) => sent.push(t));
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('BUTTON');
    expect(cta!.textContent).toBe(HERO_PRIMARY_LABEL);
    expect(cta!.disabled).toBe(false);
    await act(async () => {
      cta!.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(dom.document.activeElement?.id).toBe('chat-input');
    expect(sent).toEqual([]);
    expect((qs('#chat-input') as FakeElement).value).toBe('');
    await unmount();
  });

  it('the first screen carries ≤2 lines of auxiliary gray copy', async () => {
    await mount(VIEWPORT_W);
    const welcome = qs('.welcome')!;
    // Muted <p> blocks are the auxiliary copy: the subtitle plus the
    // starter-pill line — nothing else survives the budget.
    const muted = welcome.querySelectorAll('p');
    expect(muted.length).toBeLessThanOrEqual(2);
    expect(muted.map((p) => p.className)).toEqual(['', 'starter-chips-line']);
    expect(qs('.welcome-hint')).toBeNull();
    expect(qs('.hero-cta-lead')).toBeNull();
    expect(qs('.welcome-feature-line')).toBeNull();
    // The「完善资料」footnote is a link, not copy — it stays.
    expect(qs('.welcome-cta')).not.toBeNull();
    await unmount();
  });

  it('no text node overflows its container at 390 width — the hint is atomic nowrap pills', async () => {
    await mount(VIEWPORT_W);
    // The render-level expression a real-layout run evaluates; the fake
    // DOM reports 0/0 so the CSS contract below pins the real guarantee.
    const hero = qs('.hero')!;
    for (const el of hero._walk()) {
      expect(
        el.scrollWidth,
        `.${el.className} scrollWidth>clientWidth`,
      ).toBeLessThanOrEqual(el.clientWidth);
    }
    const line = qs('.starter-chips-line')!;
    const pills = line.querySelectorAll('.starter-pill');
    expect(pills).toHaveLength(STARTER_ENTRIES.length);
    // Each pill is one complete label — never a ·-joined sentence — so a
    // wrap can only move a whole label to the next line.
    expect(pills.map((p) => p.textContent)).toEqual(
      STARTER_ENTRIES.map((e) => e.label),
    );
    expect(line.textContent).not.toContain('·');
    for (const pill of pills) {
      expect(pill.scrollWidth).toBeLessThanOrEqual(pill.clientWidth);
      expect(pill.tagName).not.toBe('BUTTON');
    }
    await unmount();

    // The CSS contract: the row wraps freely while each pill is one
    // nowrap unit capped at the line width and ellipsising inside itself.
    const lineRule = ruleBody(chatWindowCss, '.starter-chips-line');
    expect(lineRule).toContain('flex-wrap: wrap');
    const pillRule = ruleBody(chatWindowCss, '.starter-pill');
    expect(pillRule).toContain('white-space: nowrap');
    expect(pillRule).toContain('max-width: 100%');
    expect(pillRule).toContain('overflow: hidden');
    expect(pillRule).toContain('text-overflow: ellipsis');
  });

  it('1440×900 mounts the same primary CTA — example cards stay compact-only (P380)', async () => {
    await mount(1440);
    // P380: the desktop empty state shares the one real button; the
    // compact-only example group and the three explanation cards stay
    // off it. P394: the starter capsules moved to the sidebar's 快捷入口
    // and the off-screen-pointing hint line is gone — the centre is one
    // input path now.
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('BUTTON');
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qs('.welcome-hint')).toBeNull();
    expect(qsa('.feature')).toHaveLength(0);
    await unmount();
  });
});
