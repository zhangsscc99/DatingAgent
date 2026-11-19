/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import Sidebar, { TOOL_FALLBACK } from '../src/components/Sidebar';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { TrashEntry } from '../src/lib/chatTrash';

/**
 * P361 — sidebar control-language audit, Round-96 edition (measured
 * 1795062641, 390×844, docs/runs/walk-1795062641-m6.png): P358 unified the
 * two *entry groups* (快捷入口 cards + 进阶工具 rows) but every OTHER
 * sidebar entry still resolved to its own box — new-chat CTA 10px/16px,
 * session rows 8px/10px, 回收站 8px/10px+36px, 完善资料 8px/12px, 设置
 * 6px/10px+36px — five paddings and three min-heights across one control
 * layer. Vision: "至少三处虚线/外框引起视觉混乱，边框泛滥" +
 * "关闭按钮双层描边抢了 + 新对话 的焦点", quality 3/5.
 *
 * Contract asserted here, on the REAL mounted sidebar at both 390×844
 * (mobile drawer, open) and 1440×900 (persistent aside):
 *
 *  1. Every clickable *entry* — the full-width list/navigation controls —
 *     carries the shared `data-control="row"` marker P358 introduced, and
 *     every marked element resolves to ≤2 distinct effective values for
 *     each of border-radius / padding / min-height after applying the
 *     rules a viewport of that width would see (the fake DOM has no CSS
 *     engine, so resolution runs against the parsed stylesheets with the
 *     same media-query gating a browser applies). Inline row actions
 *     (重命名/删除/清除筛选/关闭) are utility buttons, not entries — they
 *     keep their own scale deliberately.
 *  2. Zero elements inside .sidebar — including the opened 回收站 sheet —
 *     resolve to a `border-style: dashed|dotted` declaration.
 *  3. The drawer close button resolves to ≤1 box-shadow layer (and no
 *     border ring left to stack under its focus outline).
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SHEETS = [
  'index.css',
  'components/Sidebar.css',
  'components/TrashSheet.css',
  'components/SettingsSheet.css',
  'components/ConfirmDialog.css',
];

/* ---------- tiny stylesheet resolver (same idea as topbar-density.test.ts) ---------- */

interface CssRule {
  selectors: string[];
  body: string;
  order: number;
  minWidth: number;
  maxWidth: number;
}

/** Parse a stylesheet into flat rules; @media blocks contribute their
 *  min/max-width gate to the rules inside them (nested media compounds
 *  the gate). @keyframes & friends are skipped wholesale. */
function parseSheet(css: string, orderBase: number): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let order = orderBase;
  const walk = (text: string, minW: number, maxW: number) => {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf('{', i);
      if (brace < 0) return;
      const prelude = text.slice(i, brace).trim();
      let depth = 0;
      let end = text.length;
      for (let j = brace; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      const inner = text.slice(brace + 1, end);
      if (prelude.startsWith('@media')) {
        let mn = minW;
        let mx = maxW;
        for (const m of prelude.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
          if (m[1] === 'min') mn = Math.max(mn, Number(m[2]));
          else mx = Math.min(mx, Number(m[2]));
        }
        walk(inner, mn, mx);
      } else if (!prelude.startsWith('@') && prelude) {
        rules.push({
          selectors: prelude
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          body: inner,
          order: order++,
          minWidth: minW,
          maxWidth: maxW,
        });
      }
      i = end + 1;
    }
  };
  walk(src, 0, Number.POSITIVE_INFINITY);
  return rules;
}

const RULES = SHEETS.flatMap((file, i) =>
  parseSheet(readFileSync(join(SRC, file), 'utf8'), i * 100000),
);

/** One compound (`tag.a#b[x="y"]`) — state pseudos are stripped first so
 *  :hover/:focus-visible/:disabled/:not(...) rules still count toward the
 *  box an element can resolve to. A compound that was *only* pseudos
 *  (e.g. :where(...):focus-visible) matches nothing here. */
function compoundMatches(el: FakeElement, compound: string): boolean {
  let rest = compound
    .replace(/::?[a-zA-Z-]+\([^)]*\)/g, '')
    .replace(/::?[a-zA-Z-]+/g, '')
    .trim();
  if (!rest) return false;
  while (rest.length > 0) {
    if (rest[0] === '*') {
      rest = rest.slice(1);
      continue;
    }
    const tag = /^[a-zA-Z][\w-]*/.exec(rest);
    if (tag) {
      if (el.tagName !== tag[0].toUpperCase()) return false;
      rest = rest.slice(tag[0].length);
      continue;
    }
    const cls = /^\.([\w-]+)/.exec(rest);
    if (cls) {
      if (!el.classList.contains(cls[1])) return false;
      rest = rest.slice(cls[0].length);
      continue;
    }
    const id = /^#([\w-]+)/.exec(rest);
    if (id) {
      if (el.id !== id[1]) return false;
      rest = rest.slice(id[0].length);
      continue;
    }
    if (rest[0] === '[') {
      const end = rest.indexOf(']');
      if (end < 0) return false;
      const inner = rest.slice(1, end);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (!el.hasAttribute(inner.trim())) return false;
      } else {
        const name = inner.slice(0, eq).trim();
        const val = inner
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (el.getAttribute(name) !== val) return false;
      }
      rest = rest.slice(end + 1);
      continue;
    }
    return false;
  }
  return true;
}

/** `a > b`, `a b` supported; sibling combinators make the rule not match
 *  (none of the sidebar sheets use them on these controls). */
function selectorMatches(el: FakeElement, selector: string): boolean {
  const tokens = selector
    .replace(/([>+~])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
  const compounds: string[] = [];
  const combinators: ('desc' | 'child' | 'sib')[] = [];
  let pending: 'desc' | 'child' | 'sib' = 'desc';
  for (const tok of tokens) {
    if (tok === '>') {
      pending = 'child';
      continue;
    }
    if (tok === '+' || tok === '~') {
      pending = 'sib';
      continue;
    }
    compounds.push(tok);
    if (compounds.length > 1) combinators.push(pending);
    pending = 'desc';
  }
  if (!compounds.length) return false;
  if (!compoundMatches(el, compounds[compounds.length - 1])) return false;
  let node: FakeElement | null = el;
  for (let i = compounds.length - 2; i >= 0; i--) {
    const comb = combinators[i];
    if (comb === 'sib') return false;
    if (comb === 'child') {
      node = node.parentElement;
      if (!node || !compoundMatches(node, compounds[i])) return false;
    } else {
      let a: FakeElement | null = node.parentElement;
      while (a && !compoundMatches(a, compounds[i])) a = a.parentElement;
      if (!a) return false;
      node = a;
    }
  }
  return true;
}

/** (id*10000 + class/attr/pseudo*100 + tag) — enough to order the rules
 *  these stylesheets actually declare. */
function specificity(sel: string): number {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const cls = (
    sel.match(/\.[\w-]+|\[[^\]]*\]|::?[a-zA-Z-]+(\([^)]*\))?/g) ?? []
  ).length;
  const rest = sel
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[a-zA-Z-]+(\([^)]*\))?|\*/g, ' ')
    .trim();
  const tags = rest ? rest.split(/[\s>+~]+/).filter(Boolean).length : 0;
  return ids * 10000 + cls * 100 + tags;
}

/** First `prop: value` longhand declaration in a rule body. */
function declOf(body: string, prop: string): string | null {
  const m = new RegExp(`(^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[2].trim() : null;
}

/** Effective declared value of `prop` for `el` at `width` px — 'unset'
 *  when no matching rule declares it (index.css's `* { padding: 0 }`
 *  reset means every real element still lands on 0). */
function resolveProp(el: FakeElement, prop: string, width: number): string {
  let best: { spec: number; order: number; value: string } | null = null;
  for (const rule of RULES) {
    if (width < rule.minWidth || width > rule.maxWidth) continue;
    const v = declOf(rule.body, prop);
    if (v === null) continue;
    let spec = -1;
    for (const s of rule.selectors) {
      if (selectorMatches(el, s)) spec = Math.max(spec, specificity(s));
    }
    if (spec < 0) continue;
    if (
      !best ||
      spec > best.spec ||
      (spec === best.spec && rule.order > best.order)
    ) {
      best = { spec, order: rule.order, value: v };
    }
  }
  return best ? best.value : 'unset';
}

/** Rules matching `el` whose declarations paint a dashed/dotted edge —
 *  `border`, `border-style`, `border-*-style` shorthands and `outline`,
 *  plus the element's own inline style attribute. */
function dashedBorderHits(el: FakeElement, width: number): number {
  let hits = 0;
  for (const rule of RULES) {
    if (width < rule.minWidth || width > rule.maxWidth) continue;
    if (!rule.selectors.some((s) => selectorMatches(el, s))) continue;
    if (/(^|[;\s])border(-[\w-]+)*\s*:[^;]*\b(dashed|dotted)\b/.test(rule.body))
      hits++;
    if (/(^|[;\s])outline\s*:[^;]*\b(dashed|dotted)\b/.test(rule.body))
      hits++;
  }
  if (/\b(dashed|dotted)\b/.test(el.getAttribute('style') ?? '')) hits++;
  return hits;
}

/** Layers in a resolved box-shadow list — 'unset'/'none' are zero, a
 *  comma at paren depth 0 starts a new layer. */
function shadowLayerCount(value: string): number {
  if (value === 'unset' || value === 'none') return 0;
  let depth = 0;
  let layers = 1;
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) layers++;
  }
  return layers;
}

/* ---------- mounted-DOM harness ---------- */

/** matchMedia stub resolving (min|max)-width queries against a width. */
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

const SESSION: StoredChatSession = {
  id: 's-p361',
  title: '周末邀约',
  updatedAt: 1_700_000_000_000,
  messages: [
    { id: 'm1', role: 'user', content: '她周末答应出来了', createdAt: 1 },
    { id: 'm2', role: 'assistant', content: '太好了', createdAt: 2 },
  ],
};

const TRASH: TrashEntry[] = [
  {
    sessionId: 's-old',
    title: '旧对话',
    messages: [],
    deletedAt: 1_699_000_000_000,
    messageCount: 2,
  },
];

const noop = () => {};

/** The sidebar's entry-level controls — every full-width navigation/list
 *  entry a user clicks to go somewhere or start something. Inline row
 *  actions (rename/delete/clear/close) are utility buttons on purpose. */
const ENTRY_SELECTORS = [
  '.new-chat-btn',
  '.recent-chat-item',
  '.recent-chat-trash',
  '.profile-setup-btn',
  '.quick-btn',
  '.tool-entry',
  '.settings-open-btn',
];

describe('P361 · sidebar entries share one control language', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  let container: FakeElement;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (widthPx: number, mobile: boolean, withProfile = false) => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(widthPx);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    (dom.window as Record<string, unknown>).innerWidth = widthPx;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(Sidebar, {
          tools: TOOL_FALLBACK,
          profile: withProfile
            ? { name: '测试用户', age: 28, interests: ['音乐'] }
            : null,
          recentSessions: [SESSION],
          activeSessionId: SESSION.id,
          isMobile: mobile,
          open: mobile,
          trashEntries: TRASH,
          onQuickPrompt: noop,
          onNewChat: noop,
          onSelectChat: noop,
          onDeleteChat: noop,
          onRenameChat: noop,
          onClearAllChats: noop,
          onEditProfile: noop,
          onOpenSettings: noop,
          onRestoreTrash: noop,
          onClearTrash: noop,
          onClose: noop,
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

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const vp of [
    { width: 390, height: 844, mobile: true, profile: false },
    { width: 1440, height: 900, mobile: false, profile: true },
  ] as const) {
    describe(`${vp.width}×${vp.height}`, () => {
      it('every entry control carries data-control="row", and only entries do', async () => {
        await mount(vp.width, vp.mobile, vp.profile);
        const aside = qs('.sidebar');
        expect(aside).not.toBeNull();

        // Coverage: every rendered entry is marked, so a future entry can
        // never drift back into its own box without the audit noticing.
        for (const sel of ENTRY_SELECTORS) {
          const matches = aside!
            ._walk()
            .filter((el) => selectorMatches(el, sel));
          for (const el of matches) {
            expect(
              el.getAttribute('data-control'),
              `${sel} missing data-control="row"`,
            ).toBe('row');
          }
        }

        // …and the marker only ever lands on real <button> entries.
        const marked = aside!
          ._walk()
          .filter((el) => el.getAttribute('data-control') === 'row');
        // P394: the 快捷入口 rows mount at every width again — the
        // hero's capsules left the desktop, so these four rows are the
        // single copy of the starter entries.
        const quickRows = 4;
        expect(marked.length).toBeGreaterThanOrEqual(
          1 + 1 + quickRows + TOOL_FALLBACK.length + 1, // new-chat + session + quick + tools + 设置
        );
        for (const el of marked) {
          expect(el.tagName).toBe('BUTTON');
          expect(
            ENTRY_SELECTORS.some((sel) => selectorMatches(el, sel)),
            `unexpected data-control="row" on ${el.tagName}.${el.className}`,
          ).toBe(true);
        }
        await unmount();
      });

      it('entries resolve to ≤2 variants each for radius/padding/min-height', async () => {
        await mount(vp.width, vp.mobile, vp.profile);
        const aside = qs('.sidebar')!;
        const marked = aside
          ._walk()
          .filter((el) => el.getAttribute('data-control') === 'row');
        // P394: the 快捷入口 rows mount at both widths — the desktop set
        // matches the drawer's now.
        expect(marked.length).toBeGreaterThanOrEqual(10);

        for (const prop of ['border-radius', 'padding', 'min-height']) {
          const values = new Map<string, string[]>();
          for (const el of marked) {
            const v = resolveProp(el, prop, vp.width);
            const key = `${el.tagName}.${el.className.split(' ')[0]}`;
            values.set(v, [...(values.get(v) ?? []), key]);
          }
          const summary = [...values]
            .map(([v, els]) => `${v} ← ${els.join(',')}`)
            .sort()
            .join(' | ');
          expect(
            values.size,
            `${vp.width}px ${prop} variants across entries: ${summary}`,
          ).toBeLessThanOrEqual(2);
        }
        await unmount();
      });

      it('no element inside .sidebar (or its trash sheet) paints a dashed edge', async () => {
        await mount(vp.width, vp.mobile, vp.profile);
        const aside = qs('.sidebar')!;

        // Open the 回收站 sheet too — "any sidebar sheet" is in scope.
        await click(aside.querySelector('.recent-chat-trash'));
        const sheet = aside.querySelector('.trash-overlay');
        expect(sheet).not.toBeNull();

        let dashed = 0;
        const offenders: string[] = [];
        for (const el of aside._walk()) {
          const n = dashedBorderHits(el, vp.width);
          if (n > 0) {
            dashed += n;
            offenders.push(`${el.tagName}.${el.className}`);
          }
        }
        expect(
          dashed,
          `dashed/dotted edges inside .sidebar: ${offenders.join(', ')}`,
        ).toBe(0);
        await unmount();
      });

      it('the drawer close button resolves to ≤1 box-shadow layer', async () => {
        await mount(vp.width, vp.mobile, vp.profile);
        const btn = qs('.sidebar-close-btn');
        if (!vp.mobile) {
          // Desktop has no drawer close button — the aside stays persistent.
          expect(btn).toBeNull();
        } else {
          expect(btn).not.toBeNull();
          expect(
            shadowLayerCount(resolveProp(btn!, 'box-shadow', vp.width)),
          ).toBeLessThanOrEqual(1);
        }
        await unmount();
      });
    });
  }

  it('390×844: the 回收站 entry still opens its sheet (behaviour unchanged)', async () => {
    await mount(390, true);
    const aside = qs('.sidebar')!;
    await click(aside.querySelector('.recent-chat-trash'));
    const sheet = aside.querySelector('.trash-overlay');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('回收站');
    expect(sheet!.textContent).toContain('旧对话');
    await unmount();
  });
});
