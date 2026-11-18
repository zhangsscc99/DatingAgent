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
  type FakeDom,
} from './helpers/fakeDom';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P319 — sidebar filter results: the keyword a row matched on used to
 * render as plain text (no highlight at all), the 「找到 N 段对话」 count
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

async function mountSidebar() {
  const dom = installFakeDom();
  const { createRoot } = await import('react-dom/client');
  const { default: Sidebar } = await import('../src/components/Sidebar');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      createElement(Sidebar, {
        tools: [],
        recentSessions: SESSIONS,
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

  it('the match count is a plain-text status line reading 找到 2 段对话', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const count = dom.document.querySelector('.recent-chat-filter-count');
    expect(count, 'count element').toBeTruthy();
    expect(count!.tagName).toBe('SPAN');
    expect(count!.tagName).not.toBe('BUTTON');
    expect(count!.getAttribute('role')).toBe('status');
    expect(count!.textContent).toBe('找到 2 段对话');

    await act(async () => {
      (root as Root).unmount();
    });
  });
});

describe('P333 · 找到 N 段对话 count sits above the result list', () => {
  it('renders the single count element after the filter input and before the first result card', async () => {
    const { dom, root } = await mountSidebar();
    await typeFilter(dom, '看展');

    const counts = dom.document.querySelectorAll('.recent-chat-filter-count');
    expect(counts, 'exactly one count element').toHaveLength(1);
    const count = counts[0];
    expect(count.textContent).toMatch(/^找到 \d+ 段对话$/);
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

describe('P319 · 找到 N 段对话 count typography', () => {
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
