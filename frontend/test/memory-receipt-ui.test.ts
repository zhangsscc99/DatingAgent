/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P308 — the 「已记住」 receipt was a centred 12px grey line under the
 * header: no icon, no management entry, flush against the first bubble.
 * It is now an icon capsule anchored at the right of the session header
 * area, labelled 「记得你提到：…」, that expands into a list of remembered
 * items where each row is deletable (the deletion is recorded in
 * memoryReceiptDismissals and drops the fact from the receipt's client
 * state). The capsule and the bottom 「完善资料」 nudge are mutually
 * exclusive — the capsule is the resident one.
 *
 * Same split as the P304/P307 tests: markup via renderToStaticMarkup,
 * click behaviour on the fake DOM, geometry/typography asserted on the
 * resolved CSS constants.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(join(SRC, 'components', 'ChatWindow.css'), 'utf8');
const indexCss = readFileSync(join(SRC, 'index.css'), 'utf8');

const noop = () => {};

/** P296 fixture: three real turns, no stored profile, two lexicon facts. */
const factTurns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '我昨晚没睡好，一直在想怎么回她' },
  { id: 'a1', role: 'assistant', content: '先接住自己，再来想措辞。' },
  { id: 'u2', role: 'user', content: '周末本来想约她去看展' },
  { id: 'a2', role: 'assistant', content: '这个安排很轻，适合开口。' },
  { id: 'u3', role: 'user', content: '就是不知道她有没有空' },
  { id: 'a3', role: 'assistant', content: '可以先轻轻问一句时间。' },
];

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

function renderChat(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: factTurns,
      loading: false,
      onSend: noop,
      ...extra,
    }),
  );
}

/* ---------- CSS helpers (same style as P307/P304 tests) ---------- */

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return '';
}

function topLevel(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    const openBrace = css.indexOf('{', at);
    let depth = 0;
    let j = openBrace;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

function ruleBody(css: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...css.matchAll(re)].map((m) => m[1]).join('\n');
}

function declPxValues(rule: string, prop: string): number[] {
  const decl = new RegExp(`${prop}:\\s*([^;]+)`).exec(rule)?.[1].trim();
  if (!decl) return [];
  const m =
    /^([0-9.]+)(?:px)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?$/.exec(
      decl,
    );
  if (!m) return [];
  return m
    .slice(1)
    .filter((v) => v !== undefined)
    .map(Number);
}

/** Bottom component of a `padding` shorthand (CSS 1–4 value rules). */
function paddingBottomPx(rule: string): number | null {
  const longhand = declPxValues(rule, 'padding-bottom');
  if (longhand.length === 1) return longhand[0];
  const values = declPxValues(rule, 'padding');
  if (values.length === 0) return null;
  return values[values.length >= 3 ? 2 : 0];
}

function declaredProperty(css: string, selector: string, prop: string): string {
  const body = ruleBody(css, selector);
  const m = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body);
  expect(m, `${selector} should declare ${prop}`).toBeTruthy();
  return m![1].trim();
}

/* ---------- WCAG contrast (same helpers as message-actions.test.ts) ---------- */

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
  /@media \(max-width: 768px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(indexCss)?.[1] ?? null;
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

/* ---------- markup assertions ---------- */

describe('P308 · the receipt is a capsule with an icon and a management entry', () => {
  it('renders a role="status" element containing an icon node and a 记忆 entry', () => {
    stubStorage();
    const markup = renderChat({ profile: null });
    expect(markup).toContain('<div class="memory-receipt" role="status">');
    // The icon node — a real element, not a glyph in the text.
    expect(markup).toContain('<svg class="memory-capsule-icon"');
    // The clickable management entry, labelled in Chinese around 记忆.
    expect(markup).toContain('aria-label="管理记忆"');
    expect(markup).toContain('<button type="button" class="memory-capsule"');
  });

  it('names the remembered items behind the new prefix', () => {
    stubStorage();
    const markup = renderChat({ profile: null });
    expect(markup).toContain('记得你提到：');
    expect(markup).toContain('没睡好');
    expect(markup).toContain('看展');
    expect(markup).not.toContain('已记住：');
  });

  it('the capsule and the bottom 完善资料 nudge are mutually exclusive', () => {
    stubStorage(); // onboarding incomplete → the nudge would be eligible
    const withReceipt = renderChat({ profile: null, onSetupProfile: noop });
    expect(withReceipt).toContain('memory-receipt');
    expect(withReceipt).not.toContain('profile-nudge');

    // …and it is the nudge that yields: with no remembered items the same
    // conversation shape still renders the nudge (i.e. it is not simply
    // never rendered).
    const noFacts: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '她只回了一个嗯' },
      { id: 'a1', role: 'assistant', content: '先别追问，给她一点空间。' },
    ];
    const withoutReceipt = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: noFacts,
        loading: false,
        onSend: noop,
        onSetupProfile: noop,
        profile: null,
      }),
    );
    expect(withoutReceipt).not.toContain('memory-receipt');
    expect(withoutReceipt).toContain('profile-nudge');
  });
});

/* ---------- geometry / typography / contrast on the CSS ---------- */

describe('P308 · capsule readability and clearance', () => {
  const base = topLevel(chatWindowCss);
  const mobile = mediaBlock(chatWindowCss, '(max-width: 768px)');

  it('the capsule label is >= 13px and stays so at <=768px', () => {
    const body = ruleBody(base, '.memory-capsule');
    expect(body).not.toBe('');
    const size = declPxValues(body, 'font-size');
    expect(size).toHaveLength(1);
    expect(size[0]).toBeGreaterThanOrEqual(13);
    // No mobile rule may shrink it back under 13px.
    const mobileBody = ruleBody(mobile, '.memory-capsule');
    const mobileSize = declPxValues(mobileBody, 'font-size');
    if (mobileSize.length > 0) {
      expect(mobileSize[0]).toBeGreaterThanOrEqual(13);
    }
  });

  it('keeps >= 8px between the receipt row and the first message at every width', () => {
    const receiptBottom = paddingBottomPx(ruleBody(base, '.memory-receipt'));
    expect(receiptBottom).not.toBeNull();
    expect(receiptBottom!).toBeGreaterThanOrEqual(8);
    // The message column's own top padding adds further clearance; the
    // narrow breakpoint must not remove it.
    const mobilePad = declPxValues(ruleBody(mobile, '.messages'), 'padding');
    expect(mobilePad[0] ?? 0).toBeGreaterThanOrEqual(8);
    const basePad = declPxValues(ruleBody(base, '.messages'), 'padding');
    expect(basePad[0] ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('the capsule text keeps >= 4.5:1 contrast on its pill background in both themes', () => {
    const fgDecl = declaredProperty(base, '.memory-capsule', 'color');
    const bgDecl = declaredProperty(base, '.memory-capsule', 'background');
    for (const [name, vars] of CONTEXTS) {
      const fg = resolveColor(vars, fgDecl);
      const bg = resolveColor(vars, bgDecl);
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `.memory-capsule in ${name}: ${fg} on ${bg} → ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is a right-anchored pill in the header strip, not a centred full-width line', () => {
    const receipt = ruleBody(base, '.memory-receipt');
    expect(receipt).toContain('justify-content: flex-end');
    const capsule = ruleBody(base, '.memory-capsule');
    expect(capsule).toContain('border-radius: 999px');
  });
});

/* ---------- click behaviour on the fake DOM ---------- */

describe('P308 · expanding and deleting remembered items', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const click = async (el: FakeElement | null) => {
    expect(el, 'click target').toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: factTurns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-mem',
        }),
      );
    });
    await flush();
  });

  afterAll(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    vi.unstubAllGlobals();
  });

  it('the capsule expands into a list of remembered items, each deletable', async () => {
    const capsule = qs('.memory-capsule');
    expect(qs('.memory-panel')).toBeNull();
    await click(capsule);

    const panel = qs('.memory-panel');
    expect(panel).toBeTruthy();
    const rows = qsa('.memory-panel-row');
    expect(rows).toHaveLength(2);
    const deleteButtons = qsa('.memory-panel-delete');
    expect(deleteButtons).toHaveLength(2);
    for (const btn of deleteButtons) {
      expect((btn as FakeElement).getAttribute('aria-label')).toContain('记忆');
    }
    expect(capsule!.getAttribute('aria-expanded')).toBe('true');
  });

  it('deleting an item drops it from the receipt and persists the dismissal', async () => {
    const target = qsa('.memory-panel-delete').find((b) =>
      (b as FakeElement).getAttribute('aria-label')!.includes('看展'),
    ) as FakeElement;
    await click(target);

    // The receipt text no longer names 看展, the panel row is gone, and
    // the dismissal is recorded in storage (the client state behind the
    // receipt), not merely hidden in the DOM.
    expect(qs('.memory-capsule-text')!.textContent).toBe('记得你提到：没睡好');
    expect(qsa('.memory-panel-row')).toHaveLength(1);
    expect(dom.localStorage.getItem('datingagent.memoryDismissals')).toContain(
      '看展',
    );
    // The chat itself is untouched — every bubble still renders.
    expect(qsa('.bubble').length).toBe(factTurns.length);
  });

  it('deleting the last item retires the capsule entirely', async () => {
    const remaining = qs('.memory-panel-delete') as FakeElement;
    await click(remaining);

    expect(qs('.memory-receipt')).toBeNull();
    expect(qs('.memory-panel')).toBeNull();
    expect(dom.localStorage.getItem('datingagent.memoryDismissals')).toContain(
      '没睡好',
    );
    expect(qsa('.bubble').length).toBe(factTurns.length);
  });
});
