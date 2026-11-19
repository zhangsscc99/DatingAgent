/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  matchesSelector,
  type FakeDom,
} from './helpers/fakeDom';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P319 — sidebar filter results: the keyword a row matched on used to
 * render as plain text (no highlight at all), the 「找到 N 个对话」 count
 * was an sr-only announcement (visual weight zero), and the search box on
 * focus painted a pink border under a pink outline — two stacked accent
 * rings.
 *
 * Now: real <mark> nodes wrap the hit text in both the session title and
 * the P230 body-match excerpt (same scope filterRecentSessions searches);
 * the count is a visible plain-text status line at ≥12px and ≥4.5:1 on its
 * background; and the filter input never paints more than one box-shadow
 * layer / one accent ring.
 *
 * The mark-node and count-text assertions mount the real Sidebar on the
 * fake DOM (same style as sidebar-empty-state.test.ts); typography,
 * contrast and shadow-layer checks are derived from the stylesheets —
 * same approach as message-actions.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebarTsx = read('components/Sidebar.tsx');
const sidebarCss = read('components/Sidebar.css');
const indexCss = read('index.css');

/* ---------- stylesheet helpers (same pattern as message-actions.test.ts) ---------- */

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

const LIGHT_BASE = /:root\s*\{([^}]*)\}/.exec(indexCss)![1];
const LIGHT_MOBILE =
  /@media \(max-width: 768px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(indexCss)?.[1] ??
  null;
const DARK_BASE = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(indexCss)![1];
const DARK_MOBILE =
  /@media \(max-width: 768px\)\s*\{\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(
    indexCss,
  )?.[1] ?? null;

const CONTEXTS: Array<[string, Map<string, string>]> = [
  ['light', themeVars(LIGHT_BASE, null)],
  ['light @<=768px', themeVars(LIGHT_BASE, LIGHT_MOBILE)],
  ['dark', themeVars(DARK_BASE, null)],
  ['dark @<=768px', themeVars(DARK_BASE, DARK_MOBILE)],
];

/** Visible box-shadow layers in a rule body: `none` → 0; otherwise split on
 *  top-level commas (commas inside rgb()/var() do not separate layers). */
function boxShadowLayers(body: string): number {
  let layers = 0;
  for (const m of body.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
    const value = m[1].trim();
    if (/^none\b/.test(value)) continue;
    let depth = 0;
    let count = 1;
    for (const ch of value) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) count++;
    }
    layers += count;
  }
  return layers;
}

/* ---------- mounted-DOM assertions ---------- */

const msg = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
): ChatMessage => ({ id, role, content });

const NOW = Date.now();
const SESSIONS: StoredChatSession[] = [
  // Title hit — 看展 sits in the session title.
  { id: 's-title', title: '周末看展计划', updatedAt: NOW, messages: [] },
  // Body-only hit — the title lacks 看展, so the row shows the excerpt.
  {
    id: 's-body',
    title: '聊聊周末',
    updatedAt: NOW,
    messages: [msg('m1', 'user', '她约我周六一起去看展，怎么回比较好')],
  },
];

/* P354 fixtures — replays of the observed card: the title lacks the
 * keyword and the only hit sits deep inside a message, so the ±12-char
 * window clips on BOTH ends and the centred-slice assertions exercise the
 * … markers rather than the short-text fallback. */
const BODY_HIT_SESSIONS: StoredChatSession[] = [
  {
    id: 's-obs',
    title: '她三天没回我消息了',
    updatedAt: NOW,
    messages: [
      msg(
        'm1',
        'user',
        '前面铺垫了很长一段日常聊天文字之后，明天第一次约会，我有点紧张还想继续往下多说几句',
      ),
    ],
  },
];
const TITLE_HIT_SESSIONS: StoredChatSession[] = [
  {
    id: 's-long-title',
    title: '前面很长的一段标题铺垫文字之后终于说到约会这件小事',
    updatedAt: NOW,
    messages: [],
  },
];

async function mountSidebar(
  sessions: StoredChatSession[] = SESSIONS,
  width = 390,
) {
  const dom = installFakeDom();
  (dom.window as { innerWidth: number }).innerWidth = width;
  const { createRoot } = await import('react-dom/client');
  const { default: Sidebar } = await import('../src/components/Sidebar');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      createElement(Sidebar, {
        tools: [],
        recentSessions: sessions,
        onQuickPrompt: () => {},
        onNewChat: () => {},
      }),
    );
  });
  return { dom, root };
}

async function typeFilter(dom: FakeDom, text: string) {
  const input = dom.document.querySelector(
    'input.recent-chat-filter',
  ) as FakeElement | null;
  expect(input, 'filter input').toBeTruthy();
  await act(async () => {
    input!.value = text;
    input!.dispatchEvent(new FakeEvent('input', { bubbles: true }));
  });
}

describe('P319 · filter hits render as <mark>', () => {
  it('typing 看展 wraps the keyword in <mark> inside both result rows', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const items = dom.document.querySelectorAll('.recent-chat-item');
    expect(items).toHaveLength(2);

    const titleRow = items.find((el) =>
      (el.textContent ?? '').includes('周末看展计划'),
    )!;
    const titleMarks = titleRow.querySelectorAll('mark');
    expect(titleMarks.length).toBeGreaterThanOrEqual(1);
    for (const m of titleMarks) expect(m.textContent).toBe('看展');

    // Body-only hit: the keyword is marked inside the excerpt line too —
    // the same range filterRecentSessions matched on.
    const bodyRow = items.find((el) =>
      (el.textContent ?? '').includes('聊聊周末'),
    )!;
    const excerpt = bodyRow.querySelector('.recent-chat-excerpt');
    expect(excerpt, 'excerpt line').toBeTruthy();
    const excerptMarks = excerpt!.querySelectorAll('mark');
    expect(excerptMarks.length).toBeGreaterThanOrEqual(1);
    for (const m of excerptMarks) expect(m.textContent).toBe('看展');

    await act(async () => {
      (root as Root).unmount();
    });
  });

  it('the match count is a plain-text status line reading 找到 2 个对话 · 1 条消息', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const count = dom.document.querySelector('.recent-chat-filter-count');
    expect(count, 'count element').toBeTruthy();
    expect(count!.tagName).toBe('SPAN');
    expect(count!.tagName).not.toBe('BUTTON');
    expect(count!.getAttribute('role')).toBe('status');
    expect(count!.textContent).toBe('找到 2 个对话 · 1 条消息');

    await act(async () => {
      (root as Root).unmount();
    });
  });
});

describe('P333 · 找到 N 个对话 count sits above the result list', () => {
  it('renders the single count element after the filter input and before the first result card', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const counts = dom.document.querySelectorAll('.recent-chat-filter-count');
    expect(counts, 'exactly one count element').toHaveLength(1);
    const count = counts[0];
    expect(count.textContent).toMatch(/^找到 \d+ 个对话 · \d+ 条消息$/);
    expect(
      count.getAttribute('role') === 'status' ||
        count.getAttribute('aria-live'),
    ).toBeTruthy();

    const ordered = dom.document.querySelectorAll(
      'input.recent-chat-filter, .recent-chat-filter-count, .recent-chat-item',
    );
    const filterInput = ordered.find((el) =>
      el.classList.contains('recent-chat-filter'),
    )!;
    const firstItem = ordered.find((el) =>
      el.classList.contains('recent-chat-item'),
    )!;
    const countIdx = ordered.indexOf(count);
    expect(ordered.indexOf(filterInput)).toBeGreaterThanOrEqual(0);
    expect(countIdx).toBeGreaterThan(ordered.indexOf(filterInput));
    expect(countIdx).toBeLessThan(ordered.indexOf(firstItem));

    await act(async () => {
      (root as Root).unmount();
    });
  });
});

describe('P319 · 找到 N 个对话 count typography', () => {
  const body = ruleBody(sidebarCss, '.recent-chat-filter-count');

  it('declares font-size >= 12px', () => {
    const m = /font-size:\s*([\d.]+)px/.exec(body);
    expect(m, 'font-size declaration').toBeTruthy();
    expect(parseFloat(m![1])).toBeGreaterThanOrEqual(12);
  });

  it('keeps >= 4.5:1 contrast against the sidebar surface in every theme', () => {
    const colorDecl = declaredProperty(
      sidebarCss,
      '.recent-chat-filter-count',
      'color',
    );
    const bgDecl = declaredProperty(sidebarCss, '.sidebar', 'background');
    for (const [label, vars] of CONTEXTS) {
      const fg = resolveColor(vars, colorDecl);
      const bg = resolveColor(vars, bgDecl);
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('P319 · search box never stacks accent rings', () => {
  it('the filter input paints at most one box-shadow layer, focus included', () => {
    const total =
      boxShadowLayers(ruleBody(sidebarCss, '.recent-chat-filter')) +
      boxShadowLayers(ruleBody(sidebarCss, '.recent-chat-filter:focus')) +
      boxShadowLayers(ruleBody(sidebarCss, '.recent-chat-filter:focus-visible'));
    expect(total).toBeLessThanOrEqual(1);
  });

  it('focus keeps a single ring — no ring+shadow or border+outline stacking', () => {
    const focusBody = ruleBody(
      sidebarCss,
      '.recent-chat-filter:focus-visible',
    );
    expect(focusBody).not.toBe('');
    // The single affordance stays the outline ring.
    expect(boxShadowLayers(focusBody)).toBe(0);
    // The second pink edge (accent border under the accent outline) is gone.
    expect(focusBody).not.toContain('border-color');
  });
});

describe('P354 · real filter path centres the hit in a marked window', () => {
  it('typing 约会 into the real input renders a <mark> inside the result card', async () => {
    const { dom, root } = await mountSidebar(BODY_HIT_SESSIONS);
    await typeFilter(dom, '约会');

    const items = dom.document.querySelectorAll('.recent-chat-item');
    expect(items).toHaveLength(1);
    const marks = items[0].querySelectorAll('mark');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(
      marks.some((m) => (m.innerText ?? '').includes('约会')),
    ).toBe(true);

    const count = dom.document.querySelector('.recent-chat-filter-count');
    expect(count!.textContent).toBe('找到 1 个对话 · 1 条消息');

    await act(async () => {
      (root as Root).unmount();
    });
  });

  it('the preview line is the hit-centred window — ≥8 chars of context each side or … at the clipped end', async () => {
    const { dom, root } = await mountSidebar(BODY_HIT_SESSIONS);
    await typeFilter(dom, '约会');

    const excerpt = dom.document.querySelector('.recent-chat-excerpt');
    expect(excerpt, 'preview line').toBeTruthy();
    const mark = excerpt!.querySelector('mark');
    expect(mark, 'preview mark').toBeTruthy();
    expect(mark!.innerText).toContain('约会');

    const text = excerpt!.textContent ?? '';
    const hitText = mark!.innerText!;
    const idx = text.indexOf(hitText);
    const before = text.slice(0, idx);
    const after = text.slice(idx + hitText.length);
    expect(before.length >= 8 || before.startsWith('…')).toBe(true);
    expect(after.length >= 8 || after.endsWith('…')).toBe(true);
    // The fixture clips both ends, so the … markers must be real.
    expect(before.startsWith('…')).toBe(true);
    expect(after.endsWith('…')).toBe(true);

    await act(async () => {
      (root as Root).unmount();
    });
  });

  it('a hit inside a long title gets the same centred window + <mark> instead of a truncated tail', async () => {
    const { dom, root } = await mountSidebar(TITLE_HIT_SESSIONS);
    await typeFilter(dom, '约会');

    const title = dom.document.querySelector('.recent-chat-title');
    expect(title, 'title line').toBeTruthy();
    expect(title!.classList.contains('has-hit')).toBe(true);
    const mark = title!.querySelector('mark');
    expect(mark, 'title mark').toBeTruthy();
    expect(mark!.innerText).toContain('约会');
    // The keyword sat 18 chars in — the old full-title render let CSS
    // ellipsis hide it; the window surfaces it.
    expect(title!.textContent).toContain('约会');
    expect(title!.textContent!.startsWith('…')).toBe(true);

    await act(async () => {
      (root as Root).unmount();
    });
  });

  it('the search input box-shadow stays <= 1 layer across base/focus/focus-visible', () => {
    const layers =
      boxShadowLayers(ruleBody(sidebarCss, '.recent-chat-filter')) +
      boxShadowLayers(ruleBody(sidebarCss, '.recent-chat-filter:focus')) +
      boxShadowLayers(
        ruleBody(sidebarCss, '.recent-chat-filter:focus-visible'),
      );
    expect(layers).toBeLessThanOrEqual(1);
    // …and the single ring itself is 1px — the heavy pink stroke is gone.
    expect(
      ruleBody(sidebarCss, '.recent-chat-filter:focus-visible'),
    ).toMatch(/outline:\s*1px/);
  });
});

describe('P319 · mark styling + source wiring', () => {
  it('marks get a visible chip colour and zero vertical padding (no line-height change)', () => {
    const markBody = ruleBody(sidebarCss, '.recent-chat-item mark');
    expect(markBody).not.toBe('');
    expect(markBody).toMatch(/background:/);
    expect(markBody).toMatch(/color:/);
    // Horizontal-only padding — the row's line height is untouched.
    expect(markBody).not.toMatch(/line-height/);
    const pad = /padding:\s*([^;]+);/.exec(markBody);
    expect(pad).toBeTruthy();
    expect(pad![1].trim().split(/\s+/)[0]).toBe('0');
  });

  it('the row renders real <mark> nodes through highlightSegments', () => {
    expect(sidebarTsx).toContain('highlightSegments');
    expect(sidebarTsx).toContain('<mark');
    const titleIdx = sidebarTsx.indexOf('recent-chat-title');
    const excerptIdx = sidebarTsx.indexOf('recent-chat-excerpt');
    expect(sidebarTsx.slice(titleIdx, excerptIdx)).toContain('highlightHit');
    expect(
      sidebarTsx.slice(excerptIdx, sidebarTsx.indexOf('recent-chat-meta')),
    ).toContain('highlightHit');
  });
});

/* ---------- P372 · a real getComputedStyle over the shipped stylesheets ----------
 * The fake DOM ships no layout engine (window.getComputedStyle returns ''),
 * so this installs a genuine cascade: every rule in the real Sidebar.css /
 * index.css is parsed, matched against the mounted tree with the same
 * matchesSelector engine querySelector uses, media queries evaluated
 * against the fake viewport (390px), var() resolved from the :root theme
 * tokens, and inherited properties walked up the ancestor chain — exactly
 * what the browser's getComputedStyle does, on the real authored values. */

interface CssRule {
  selector: string;
  decls: Map<string, string>;
  order: number;
}

/** Evaluate the media features the stylesheets actually use, against the
 *  fake-DOM environment (motion allowed, light scheme) at `width` px —
 *  P383 runs the same cascade at 390×844 and 1440×900. */
function mediaMatches(query: string, width: number): boolean {
  const q = query.trim();
  const maxW = /max-width:\s*(\d+)px/.exec(q);
  if (maxW) return width <= parseInt(maxW[1], 10);
  const minW = /min-width:\s*(\d+)px/.exec(q);
  if (minW) return width >= parseInt(minW[1], 10);
  if (/prefers-reduced-motion\s*:\s*reduce/.test(q)) return false;
  if (/prefers-color-scheme\s*:\s*dark/.test(q)) return false;
  return false;
}

function parseStylesheet(css: string, width: number): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let order = 0;
  const readRules = (text: string, include: boolean) => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const selector = m[1].trim();
      if (!selector || selector.startsWith('@')) continue;
      if (!include) continue;
      const decls = new Map<string, string>();
      for (const d of m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
        decls.set(d[1].trim(), d[2].trim());
      }
      rules.push({ selector, decls, order: order++ });
    }
  };
  // Peel @media blocks first so their inner rules keep their condition.
  let rest = '';
  for (let i = 0; i < clean.length; ) {
    if (clean.startsWith('@media', i)) {
      const brace = clean.indexOf('{', i);
      const query = clean.slice(i + 6, brace);
      let depth = 0;
      let end = brace;
      for (; end < clean.length; end++) {
        if (clean[end] === '{') depth++;
        else if (clean[end] === '}' && --depth === 0) break;
      }
      if (mediaMatches(query, width))
        readRules(clean.slice(brace + 1, end), true);
      i = end + 1;
    } else {
      rest += clean[i];
      i++;
    }
  }
  readRules(rest, true);
  return rules;
}

/** Per-viewport cascade: the ≤768px mobile theme tokens only apply below
 *  the breakpoint, and every @media rule gates on the width under test. */
function cascadeFor(width: number) {
  return {
    rules: parseStylesheet(sidebarCss + '\n' + indexCss, width),
    vars: themeVars(LIGHT_BASE, width <= 768 ? LIGHT_MOBILE : null),
  };
}

function ancestors(el: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  for (let n = el.parentElement; n; n = n.parentElement) out.push(n);
  return out;
}

/** Descendant-only selector matching: the last compound must match el;
 *  earlier compounds must match ancestors in order. Pseudo selectors are
 *  dropped except :root (documentElement). */
function ruleMatches(el: FakeElement, selector: string): boolean {
  return selector.split(',').some((sel) => {
    const compounds = sel.trim().replace(/\s*>\s*/g, ' ').split(/\s+/);
    const last = compounds[compounds.length - 1];
    if (!last || /:(?!root\b)/.test(last.replace(/^:root/, ''))) {
      if (last !== ':root' && last.includes(':')) return false;
    }
    const matchOne = (node: FakeElement, compound: string): boolean => {
      if (compound === ':root') return node === node.ownerDocument?.documentElement;
      return matchesSelector(node, compound);
    };
    if (!matchOne(el, last)) return false;
    let chain = ancestors(el);
    for (let i = compounds.length - 2; i >= 0; i--) {
      const idx = chain.findIndex((a) => matchOne(a, compounds[i]));
      if (idx < 0) return false;
      chain = chain.slice(idx + 1);
    }
    return true;
  });
}

const INHERITED = new Set(['color', 'font-weight', 'font-size', 'font-family', 'line-height']);

function resolveDecl(declared: string, vars: Map<string, string>): string {
  return declared.replace(/var\((--[a-z-]+)\)/g, (_, name) => {
    const v = vars.get(name);
    expect(v, `resolving ${name}`).toBeTruthy();
    return v!;
  });
}

/** The computed value of one property on one element: last matching
 *  declaration in source order wins; inherited properties fall back to
 *  the nearest ancestor that declares them. */
function computedValue(
  el: FakeElement,
  prop: string,
  rules: CssRule[],
  vars: Map<string, string>,
): string {
  const lookup = (node: FakeElement): string | null => {
    let value: string | null = null;
    for (const rule of rules) {
      if (!ruleMatches(node, rule.selector)) continue;
      const decl = rule.decls.get(prop) ?? (prop === 'background-color' ? rule.decls.get('background') : undefined);
      if (decl !== undefined) value = decl;
    }
    const inline = node.style[prop] ?? node.style[prop.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())];
    if (typeof inline === 'string' && inline) value = inline;
    return value;
  };
  let value = lookup(el);
  if (value === null && INHERITED.has(prop)) {
    for (const a of ancestors(el)) {
      value = lookup(a);
      if (value !== null) break;
    }
  }
  if (value === null) {
    if (prop === 'background-color' || prop === 'background') return 'rgba(0, 0, 0, 0)';
    if (prop === 'font-weight') return '400';
    return '';
  }
  return resolveDecl(value, vars);
}

function installRealGetComputedStyle(dom: FakeDom, width: number) {
  const { rules, vars } = cascadeFor(width);
  const fn = (el: FakeElement) =>
    new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'getPropertyValue')
            return (name: string) => computedValue(el, name, rules, vars);
          return computedValue(
            el,
            String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
            rules,
            vars,
          );
        },
      },
    );
  (dom.window as { getComputedStyle: unknown }).getComputedStyle = fn;
  (globalThis as { getComputedStyle: unknown }).getComputedStyle = fn;
  return fn as unknown as (el: FakeElement) => CSSStyleDeclaration;
}

/* ---------- P377 helpers ---------- */

/** Parse a computed colour (#rgb / #rrggbb / rgb() / rgba()) into 0-255
 *  channels; null for unparseable values like 'transparent'. */
function rgbChannels(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((x) => x + x)
        .join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

/** WCAG relative luminance of a computed colour, or null if unparseable. */
function luminanceOf(color: string): number | null {
  const ch = rgbChannels(color);
  if (!ch) return null;
  return (
    0.2126 * channel(ch[0] / 255) +
    0.7152 * channel(ch[1] / 255) +
    0.0722 * channel(ch[2] / 255)
  );
}

/** P383 — the mark-readability and in-box-clear contracts are re-run at
 *  both walkthrough sizes: 390×844 (drawer) and 1440×900 (persistent
 *  aside). The fake cascade gates every @media rule on the width, so the
 *  1440 run resolves against the desktop theme tokens too. */
const VIEWPORTS = [
  { label: '390×844', width: 390 },
  { label: '1440×900', width: 1440 },
] as const;

describe('P372/P377 · <mark> is visually distinguishable and the count uses one measure-word scheme', () => {
  for (const vp of VIEWPORTS) {
    it(`computed styles at ${vp.label}: 700-weight underlined hit whose white text or solid chip separates from the card`, async () => {
      const { dom, root } = await mountSidebar(BODY_HIT_SESSIONS, vp.width);
      installRealGetComputedStyle(dom, vp.width);
      await typeFilter(dom, '约会');

      const item = dom.document.querySelector('.recent-chat-item')!;
      const mark = item.querySelector('mark');
      expect(mark, 'hit mark').toBeTruthy();

      const markStyle = getComputedStyle(mark as unknown as HTMLElement);
      const parentStyle = getComputedStyle(
        mark!.parentElement as unknown as HTMLElement,
      );
      expect(markStyle.backgroundColor).not.toBe('');
      expect(markStyle.backgroundColor).not.toBe(parentStyle.backgroundColor);
      expect(parseInt(markStyle.fontWeight, 10)).toBeGreaterThanOrEqual(700);
      expect(markStyle.textDecoration).toContain('underline');

      // The verify contract: white-ish text, or a chip luminance ≥0.15 away
      // from the card it sits on — the old soft-tint mark satisfied neither.
      const fg = rgbChannels(markStyle.color);
      const whiteText = fg !== null && fg.every((v) => v >= 240);
      const markLum = luminanceOf(markStyle.backgroundColor);
      const parentLum = luminanceOf(parentStyle.backgroundColor);
      const separated =
        markLum !== null &&
        parentLum !== null &&
        Math.abs(markLum - parentLum) >= 0.15;
      expect(
        whiteText || separated,
        `mark color ${markStyle.color} on ${markStyle.backgroundColor} vs parent ${parentStyle.backgroundColor}`,
      ).toBe(true);

      await act(async () => {
        (root as Root).unmount();
      });
    });
  }

  it('the count line reads 找到 N 个对话 · M 条消息 — and the card chip uses the same 条消息 unit, never 段对话', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const count = dom.document.querySelector('.recent-chat-filter-count');
    expect(count, 'count element').toBeTruthy();
    expect(count!.textContent).toMatch(/找到 \d+ 个对话/);
    expect(count!.textContent).toMatch(/\d+ 条消息/);
    expect(count!.textContent).not.toContain('段对话');

    // The same unit inside the result card — no bare 条 chip left.
    const cardCount = dom.document.querySelector('.recent-chat-count');
    expect(cardCount, 'in-card count chip').toBeTruthy();
    expect(cardCount!.textContent).toMatch(/\d+ 条消息/);
    expect(cardCount!.textContent).not.toContain('个对话');

    // The zero-match copy uses the 段对话 measure word too.
    await typeFilter(dom, '不存在');
    const hint = dom.document.querySelector('.filter-empty-hint-text');
    expect(hint, 'empty hint').toBeTruthy();
    expect(hint!.textContent).toContain('段对话');
    expect(hint!.textContent).not.toContain('个对话');

    await act(async () => {
      (root as Root).unmount();
    });
  });
});

describe('P377 · in-box clear button + aligned row action icons', () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.label}: mounts a 清除 button inside the box only while a query is typed; clicking restores every card and refocuses the input`, async () => {
      const { dom, root } = await mountSidebar(SESSIONS, vp.width);
      const input = dom.document.querySelector(
        'input.recent-chat-filter',
      ) as FakeElement | null;
      expect(input, 'filter input').toBeTruthy();
      // Nothing to clear before the first keystroke — and the P383 live-DOM
      // probe `.sidebar button[aria-label*=清除]` finds no in-box control yet
      // either (the fake DOM matches single compounds only, so the probe is
      // expressed as a .sidebar-descendant button whose label contains 清除).
      expect(
        dom.document.querySelector('.recent-chat-filter-clear'),
      ).toBeNull();
      const clearButtons = () =>
        dom.document
          .querySelectorAll('button')
          .filter(
            (b) =>
              b.closest('.sidebar') !== null &&
              (b.getAttribute('aria-label') ?? '').includes('清除'),
          );
      expect(clearButtons()).toHaveLength(0);
      const unfilteredCount = dom.document.querySelectorAll(
        '.recent-chat-item',
      ).length;
      expect(unfilteredCount).toBe(SESSIONS.length);

      await typeFilter(dom, '看展');
      const clear = dom.document.querySelector(
        'button.recent-chat-filter-clear',
      ) as FakeElement | null;
      expect(clear, 'in-box clear button').toBeTruthy();
      expect(clear!.getAttribute('aria-label') ?? '').toContain('清除');
      expect(clear!.tagName).toBe('BUTTON');
      // The live probe now hits: a 清除-labelled button inside .sidebar.
      expect(clearButtons().length).toBeGreaterThanOrEqual(1);
      expect(clear!.closest('.sidebar')).not.toBeNull();
      expect(dom.document.querySelectorAll('.recent-chat-item').length)
        .toBeLessThanOrEqual(unfilteredCount);

      await act(async () => {
        clear!.dispatchEvent(
          new FakeEvent('click', { bubbles: true, cancelable: true }),
        );
      });

      // Filter value cleared, every stored conversation back, focus in the box.
      expect(input!.value).toBe('');
      expect(dom.document.querySelectorAll('.recent-chat-item')).toHaveLength(
        unfilteredCount,
      );
      expect(dom.document.activeElement).toBe(input);

      await act(async () => {
        (root as Root).unmount();
      });
    });
  }

  it('the clear button is a ≥32×32 target pinned inside the box, with input padding keeping text from sliding under it', () => {
    const wrap = ruleBody(sidebarCss, '.recent-chat-filter-wrap');
    expect(wrap).toMatch(/position:\s*relative/);

    const body = ruleBody(sidebarCss, '.recent-chat-filter-clear');
    expect(body).not.toBe('');
    expect(body).toMatch(/position:\s*absolute/);
    const w = /width:\s*([\d.]+)px/.exec(body);
    const h = /height:\s*([\d.]+)px/.exec(body);
    expect(Number(w?.[1]), 'clear button width').toBeGreaterThanOrEqual(32);
    expect(Number(h?.[1]), 'clear button height').toBeGreaterThanOrEqual(32);

    // The input's right padding reserves the button slot, so typed text
    // can never run underneath the ×.
    const inputBody = ruleBody(sidebarCss, '.recent-chat-filter');
    const pad = /padding:\s*([^;]+);/.exec(inputBody);
    expect(pad, 'input padding').toBeTruthy();
    const toks = pad![1].trim().split(/\s+/);
    const rightPad = parseFloat(toks.length >= 2 ? toks[1] : toks[0]);
    expect(rightPad).toBeGreaterThanOrEqual(32);
  });

  it('row action icons share the text block vertical axis — centre-Y within 6px — via align-self:center', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const item = dom.document.querySelector('.recent-chat-item')!;
    const centre = (r: { top: number; height: number }) => r.top + r.height / 2;
    const itemCentre = centre(item.getBoundingClientRect());

    for (const sel of ['.recent-chat-rename', '.recent-chat-delete']) {
      const btn = dom.document.querySelector(sel);
      expect(btn, sel).toBeTruthy();
      const diff = Math.abs(centre(btn!.getBoundingClientRect()) - itemCentre);
      expect(diff, `${sel} centre-Y drift`).toBeLessThanOrEqual(6);
    }

    // CSS-level contract: the buttons centre themselves in the row rather
    // than stretching edge-to-edge.
    for (const sel of ['.recent-chat-rename', '.recent-chat-delete']) {
      expect(ruleBody(sidebarCss, sel)).toMatch(/align-self:\s*center/);
    }

    await act(async () => {
      (root as Root).unmount();
    });
  });
});

describe('P395 · the filter reads as a field again and the count is back to 个对话', () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.label}: the input carries a filled surface ≥0.05 luminance away from the sidebar and a non-zero radius, still borderless and shadowless`, async () => {
      const { dom, root } = await mountSidebar(SESSIONS, vp.width);
      installRealGetComputedStyle(dom, vp.width);

      const input = dom.document.querySelector('input.recent-chat-filter');
      const sidebar = dom.document.querySelector('.sidebar');
      expect(input, 'filter input').toBeTruthy();
      expect(sidebar, 'sidebar').toBeTruthy();
      const inputStyle = getComputedStyle(input as unknown as HTMLElement);
      const sidebarStyle = getComputedStyle(
        sidebar as unknown as HTMLElement,
      );

      const inputLum = luminanceOf(inputStyle.backgroundColor);
      const sidebarLum = luminanceOf(sidebarStyle.backgroundColor);
      expect(
        inputLum,
        `filter bg ${inputStyle.backgroundColor}`,
      ).not.toBeNull();
      expect(
        sidebarLum,
        `sidebar bg ${sidebarStyle.backgroundColor}`,
      ).not.toBeNull();
      expect(
        Math.abs(inputLum! - sidebarLum!),
        `filter ${inputStyle.backgroundColor} vs sidebar ${sidebarStyle.backgroundColor}`,
      ).toBeGreaterThanOrEqual(0.05);

      expect(inputStyle.borderRadius).not.toBe('0px');
      expect(
        parseFloat(inputStyle.borderRadius),
        `radius ${inputStyle.borderRadius}`,
      ).toBeGreaterThan(0);

      // The P384 inset contract still holds: no outer border, no shadow.
      const body = ruleBody(sidebarCss, '.recent-chat-filter');
      expect(body).toMatch(/border:\s*none/);
      expect(boxShadowLayers(body)).toBe(0);

      await act(async () => {
        (root as Root).unmount();
      });
    });

    it(`${vp.label}: the in-box clear × is a ≥28×28 circular chip on a light base`, async () => {
      const { dom, root } = await mountSidebar(SESSIONS, vp.width);
      installRealGetComputedStyle(dom, vp.width);
      await typeFilter(dom, '看展');

      const clear = dom.document.querySelector(
        'button.recent-chat-filter-clear',
      );
      expect(clear, 'in-box clear button').toBeTruthy();
      const style = getComputedStyle(clear as unknown as HTMLElement);
      expect(
        parseFloat(style.width),
        `width ${style.width}`,
      ).toBeGreaterThanOrEqual(28);
      expect(
        parseFloat(style.height),
        `height ${style.height}`,
      ).toBeGreaterThanOrEqual(28);

      // A round chip on a declared base — no longer the bare header-style ×.
      const body = ruleBody(sidebarCss, '.recent-chat-filter-clear');
      expect(body).toMatch(/background:\s*var\(--[a-z-]+\)/);
      const radius = parseFloat(style.borderRadius);
      expect(
        radius >= Math.min(parseFloat(style.width), parseFloat(style.height)) / 2 ||
          /%/.test(style.borderRadius),
        `radius ${style.borderRadius}`,
      ).toBe(true);

      await act(async () => {
        (root as Root).unmount();
      });
    });
  }

  it('the count line matches /找到 \\d+ 个对话/ and never falls back to 段对话', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const count = dom.document.querySelector('.recent-chat-filter-count');
    expect(count, 'count element').toBeTruthy();
    expect(count!.textContent).toMatch(/找到 \d+ 个对话/);
    expect(count!.textContent).not.toContain('段对话');

    await act(async () => {
      (root as Root).unmount();
    });
  });
});
