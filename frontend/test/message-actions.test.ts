/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, type FakeDom, type FakeElement } from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P304 — 实测 m2/m4 与 d2: the 「复制 / 换一个」 pills were 浅灰字浅灰描边 at
 * 55% opacity (~2.4:1 — nearly invisible on a phone), the pink user bubble
 * carried a useless 「复制」 of the sender's own sentence, and the
 * 「约 X 秒」 latency badge sat in the body hierarchy grabbing attention.
 *
 * Fix contract asserted here:
 *  1. role=user bubbles render no copy button (and no actions row at all);
 *     assistant bubbles keep 「复制」.
 *  2. The copy/regen pill text resolves — through the real stylesheets —
 *     to a foreground/background pair with WCAG contrast >= 4.5:1 in both
 *     light and dark themes, at desktop and <=768px widths.
 *  3. The meta row shows the reply's age (「刚刚」 on a fresh reply); the
 *     exact seconds survive only inside the title tooltip.
 *
 * vitest runs in node on the fake DOM, so "computed style" is computed the
 * way the browser would: the declared value on `.copy-btn`/`.regen-btn`
 * (a `var(--x)` reference) is resolved through index.css's :root blocks for
 * each theme/width context, against the `.bubble.assistant` background the
 * transparent pill sits on.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');
const indexCss = readFileSync(join(SRC, 'index.css'), 'utf8');

const USER: ChatMessage = {
  id: 'u-1',
  role: 'user',
  content: '她今天答应周末出来了',
  createdAt: Date.now(),
};

const ASSISTANT: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  content: '可以回得开心但不过度激动。',
  createdAt: Date.now(),
  meta: { tokens: 120, latencyMs: 8800 },
};

/* ---------- stylesheet resolution helpers ---------- */

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
function themeVars(baseBody: string, mobileBody: string | null): Map<string, string> {
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

/** The four contexts the pills can render in: light/dark x desktop/mobile. */
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
  const m = /@media \(max-width: 768px\)\s*\{\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(
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

const bubbleBgDecl = declaredProperty(bubbleCss, '.bubble.assistant', 'background');

/* ---------- mounted-DOM assertions ---------- */

describe('P304 · copy action visibility per role', () => {
  let dom: FakeDom;

  const userRow = () => {
    const row = dom.document.querySelector('.bubble-row.user');
    expect(row, 'user row').not.toBeNull();
    return row!;
  };
  const assistantRow = () => {
    const row = dom.document.querySelector('.bubble-row.assistant');
    expect(row, 'assistant row').not.toBeNull();
    return row!;
  };

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: MessageBubble } = await import('../src/components/MessageBubble');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(MessageBubble, { message: USER }),
          createElement(MessageBubble, { message: ASSISTANT }),
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(() => {
    // fake DOM is process-global; nothing persistent to tear down
  });

  it('a user message renders no 复制 button — no actions row at all', () => {
    const row = userRow();
    expect(row.querySelector('.copy-btn')).toBeNull();
    expect(row.querySelector('.bubble-actions')).toBeNull();
    expect(row.textContent).not.toContain('复制');
  });

  it('an assistant message renders the 复制 button inside .bubble-actions', () => {
    const row = assistantRow();
    const actions = row.querySelector('.bubble-actions');
    expect(actions, '.bubble-actions').not.toBeNull();
    const btn = actions!.querySelector('.copy-btn');
    expect(btn, '.copy-btn').not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('复制回复');
    expect(btn!.textContent).toContain('复制');
  });

  it('the 「换一个」 logic is untouched — regen still offered on assistant bubbles', () => {
    // The actions-row guard still keys on canCopy || canRegen; the regen
    // button is gated by its own canRegen flag, not by role alone.
    const tsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
    expect(tsx).toContain('{(canCopy || canRegen) && (');
    expect(tsx).toContain('className="regen-btn"');
  });
});

describe('P304 · action pill text contrast >= 4.5:1', () => {
  for (const selector of ['.copy-btn', '.regen-btn']) {
    it(`${selector} text vs assistant bubble background passes 4.5:1 in every theme`, () => {
      const fgDecl = declaredProperty(bubbleCss, selector, 'color');
      for (const [name, vars] of CONTEXTS) {
        const fg = resolveColor(vars, fgDecl);
        const bg = resolveColor(vars, bubbleBgDecl);
        const ratio = contrastRatio(fg, bg);
        expect(
          ratio,
          `${selector} in ${name}: ${fg} on ${bg} → ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${selector} has no opacity dimming the text below full strength`, () => {
      const body = ruleBody(bubbleCss, selector);
      const base = body.split('}')[0];
      // The P304 defect: `opacity: 0.55` blended the grey text into the
      // bubble to ~2.4:1. The base rule must not reintroduce a fade.
      expect(base).not.toMatch(/opacity\s*:\s*0?\.\d+/);
    });
  }

  it('the pill text no longer uses the faint --text-muted token', () => {
    for (const selector of ['.copy-btn', '.regen-btn']) {
      const body = ruleBody(bubbleCss, selector).split('}')[0];
      expect(body).not.toContain('var(--text-muted)');
    }
  });
});

describe('P304 · latency badge leaves the body hierarchy', () => {
  let dom: FakeDom;

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: MessageBubble } = await import('../src/components/MessageBubble');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(MessageBubble, { message: ASSISTANT }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  const metaRow = (): FakeElement => {
    const row = dom.document.querySelector('.reply-meta');
    expect(row, '.reply-meta').not.toBeNull();
    return row!;
  };

  it('shows the reply age instead of the 「约 X 秒」 number', () => {
    const row = metaRow();
    expect(row.textContent).toBe('刚刚');
    expect(row.textContent).not.toMatch(/约 [\d.]+ 秒/);
    expect(row.textContent).not.toContain('tokens');
  });

  it('keeps the exact seconds and token count in the title tooltip', () => {
    expect(metaRow().getAttribute('title')).toBe('120 tokens · 8.8s');
  });
});
