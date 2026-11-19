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
  type FakeDom,
} from './helpers/fakeDom';
import Sidebar, { TOOL_FALLBACK } from '../src/components/Sidebar';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { TrashEntry } from '../src/lib/chatTrash';

/**
 * P378 — sidebar chrome-density audit, Round-99 edition (measured
 * 1795090365, 390×844, docs/runs/walk-1795090365-m7.png): P368/P361 had
 * already unified the row box and removed every dashed edge, but vision
 * still read 「到处都是圆角框」— every 快捷入口 / 进阶工具 item wore its own
 *浅灰描边卡片, the 完善资料 entry was a bordered shell around a filled inner
 * button (双层容器), 「筛选对话」 and 「回收站（0）」 rendered as near-
 * identical浅灰圆角条, 「清空全部对话」 was bare text, and the 进阶工具
 * block's last row clipped at the drawer fold.
 *
 * The fix: quick/tool entries are borderless list rows (only :hover/:focus
 * paints a fill), the filter field is a true inset (no border, no shadow,
 * left magnifier + hairline), 清空全部对话 is a secondary pill with a trash
 * glyph whose tooltip says 移到回收站, the 回收站 row is an icon + label +
 * chevron list row (never a twin of the filter), 完善资料 is one layer, and
 * 进阶工具 folds into a <details> group collapsed by default.
 *
 * Asserted on the REAL mounted sidebar at 390×844 (drawer, open) and
 * 1440×900 (persistent aside) — the fake DOM ships no CSS engine, so the
 * stylesheet is parsed and resolved against the tree with media-query
 * gating, the same harness sidebar-controls-consistency.test.ts runs. All
 * resolutions are RESTING state: :hover/:focus/:disabled rules are skipped
 * so the audit counts the frames a user actually sees at rest.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SHEETS = [
  'index.css',
  'components/Sidebar.css',
  'components/TrashSheet.css',
  'components/SettingsSheet.css',
];

/* ---------- resting-state stylesheet resolver ---------- */

interface CssRule {
  selectors: string[];
  body: string;
  order: number;
  minWidth: number;
  maxWidth: number;
}

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

/** Compound match for the RESTING style — a compound carrying any pseudo
 *  (`:hover`, `:focus-visible`, `:not(...)`, `::marker`, …) never matches:
 *  those rules describe a state, and this audit measures the box a user
 *  sees before interacting. A compound that is only pseudos also fails. */
function compoundMatches(el: FakeElement, compound: string): boolean {
  let rest = compound.trim();
  if (!rest) return false;
  while (rest.length > 0) {
    if (rest[0] === '*') {
      rest = rest.slice(1);
      continue;
    }
    if (rest[0] === ':') return false; // any pseudo → not the resting style
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

function declOf(body: string, prop: string): string | null {
  const m = new RegExp(`(^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[2].trim() : null;
}

/** Effective declared value of `prop` for `el` at `width` px — 'unset'
 *  when no matching rule declares it (so there is no border/shadow to
 *  count). Pseudo-bearing rules never match, so the answer is the resting
 *  computed value. */
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

/* ---------- border / shadow interpretation ---------- */

const STYLE_WORD =
  /\b(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)\b/;
const WIDTH_WORD = /^(thin|medium|thick|[\d.]+(px|rem|em|pt|pc|cm|mm|in|q|%)?)$/;

interface BorderBox {
  style: string;
  width: string | null;
  color: string | null;
}

/** The resting border an element resolves to: shorthand first, then the
 *  individual longhands override (same order the cascade applies). */
function borderBox(el: FakeElement, width: number): BorderBox {
  const box: BorderBox = { style: 'none', width: null, color: null };
  const shorthand = resolveProp(el, 'border', width);
  if (shorthand !== 'unset') {
    for (const tok of shorthand.split(/\s+/)) {
      if (STYLE_WORD.test(tok)) box.style = tok;
      else if (WIDTH_WORD.test(tok)) box.width = tok;
      else box.color = box.color ? `${box.color} ${tok}` : tok;
    }
  }
  const longStyle = resolveProp(el, 'border-style', width);
  if (longStyle !== 'unset') box.style = longStyle;
  const longWidth = resolveProp(el, 'border-width', width);
  if (longWidth !== 'unset') box.width = longWidth;
  const longColor = resolveProp(el, 'border-color', width);
  if (longColor !== 'unset') box.color = longColor;
  return box;
}

/** A border the user can actually see: real style, non-zero width, and a
 *  colour that is not fully transparent. `1px solid transparent` reserves
 *  layout space but paints nothing, so it does not count toward density. */
function paintsVisibleBorder(el: FakeElement, width: number): boolean {
  const { style, width: w, color } = borderBox(el, width);
  if (style === 'none' || style === 'hidden') return false;
  if (
    w !== null &&
    w
      .split(/\s+/)
      .every((tok) => /^0([a-z%]*)?$/.test(tok))
  )
    return false;
  if (color !== null) {
    const c = color.trim();
    if (c === 'transparent') return false;
    if (/^rgba\(\s*[\d.]+%?[,\s]+[\d.]+%?[,\s]+[\d.]+%?[,/\s]+0\s*\)$/.test(c))
      return false;
  }
  return true;
}

/** Visible box-shadow layers — 'unset'/'none' are zero, a comma at paren
 *  depth 0 starts a new layer. */
function shadowLayers(el: FakeElement, width: number): number {
  const value = resolveProp(el, 'box-shadow', width);
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

/* ---------- P384 · painted-surface / laid-out helpers ----------
 * The density audit above only reads raw declarations. P384's two extra
 * contracts — the 最近对话 section must paint ≥2 distinguishable
 * luminances, and a folded 进阶工具 row must own no layout box — need
 * var() resolution (light-theme :root tokens, mobile overrides below
 * 768px) and an ancestor walk for inherited paint. */

const INDEX_CSS = readFileSync(join(SRC, 'index.css'), 'utf8');
const LIGHT_ROOT_BLOCK = /(?:^|\n)\s*:root\s*\{([^}]*)\}/.exec(INDEX_CSS)![1];
const LIGHT_ROOT_MOBILE =
  /@media \(max-width: 768px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
    INDEX_CSS,
  )?.[1] ?? '';

function themeVarsFor(width: number): Map<string, string> {
  const vars = new Map<string, string>();
  const src = LIGHT_ROOT_BLOCK + (width <= 768 ? LIGHT_ROOT_MOBILE : '');
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].trim());
  }
  return vars;
}

function resolveVars(value: string, vars: Map<string, string>): string {
  return value.replace(
    /var\((--[\w-]+)\)/g,
    (_, name) => vars.get(name) ?? 'unset',
  );
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba | null {
  const c = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((x) => x + x)
        .join('');
    const n = parseInt(h, 16);
    const hasAlpha = h.length === 8;
    return {
      r: (n >> (hasAlpha ? 24 : 16)) & 255,
      g: (n >> (hasAlpha ? 16 : 8)) & 255,
      b: (n >> (hasAlpha ? 8 : 0)) & 255,
      a: hasAlpha ? (n & 255) / 255 : 1,
    };
  }
  const fn =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(
      c,
    );
  if (fn) {
    const a = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? Number(fn[4].slice(0, -1)) / 100 : Number(fn[4]);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a };
  }
  return null;
}

/** The flat colour an element paints as its OWN background, var()
 *  resolved — null for 'unset'/'transparent'/'none'/non-colour
 *  shorthands (gradients, urls, multi-token backgrounds). */
function ownPaint(
  el: FakeElement,
  width: number,
  vars: Map<string, string>,
): Rgba | null {
  for (const prop of ['background-color', 'background']) {
    const raw = resolveProp(el, prop, width);
    if (raw === 'unset') continue;
    const v = resolveVars(raw, vars).trim();
    if (
      v === 'unset' ||
      v === 'transparent' ||
      v === 'none' ||
      v === 'initial' ||
      v === 'inherit'
    ) {
      return null;
    }
    const single = parseColor(v);
    if (single) return single;
    // A shorthand holding more than a colour (image, position, …) paints
    // no flat fill — only accept it when one bare colour token survives.
    const tok = v.split(/\s+/).find((t) => parseColor(t) !== null);
    return tok ? parseColor(tok) : null;
  }
  return null;
}

/** Effective painted surface under `el`: its own fill composited over the
 *  nearest painted ancestor, so a transparent row reads as the sidebar's
 *  surface and an --accent-soft card reads as pink-on-white — the same
 *  luminance a screenshot sees. */
function effectivePaint(
  el: FakeElement,
  width: number,
  vars: Map<string, string>,
): [number, number, number] | null {
  const layers: Rgba[] = [];
  for (let n: FakeElement | null = el; n; n = n.parentElement) {
    const p = ownPaint(n, width, vars);
    if (p) {
      layers.push(p);
      if (p.a >= 1) break;
    }
  }
  if (!layers.length) return null;
  let rgb: [number, number, number] = [layers[0].r, layers[0].g, layers[0].b];
  let a = layers[0].a;
  for (let i = 1; i < layers.length && a < 1; i++) {
    const under = layers[i];
    rgb = [
      a * rgb[0] + (1 - a) * under.a * under.r + (1 - a) * (1 - under.a) * 255,
      a * rgb[1] + (1 - a) * under.a * under.g + (1 - a) * (1 - under.a) * 255,
      a * rgb[2] + (1 - a) * under.a * under.b + (1 - a) * (1 - under.a) * 255,
    ];
    a = a + (1 - a) * under.a;
  }
  return rgb;
}

function lumChannel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a composited rgb triple. */
function luminance(rgb: [number, number, number]): number {
  return (
    0.2126 * lumChannel(rgb[0] / 255) +
    0.7152 * lumChannel(rgb[1] / 255) +
    0.0722 * lumChannel(rgb[2] / 255)
  );
}

/** P384's "laid out" predicate: the walkthrough counted a row as laid out
 *  when it had a box (getBoundingClientRect().height > 0). The fake DOM has
 *  no layout engine, so the equivalent is the resolved display chain — any
 *  ancestor display:none removes the boxes for the whole subtree. */
function laidOut(el: FakeElement, width: number, stopAt: FakeElement): boolean {
  for (let n: FakeElement | null = el; n && n !== stopAt; n = n.parentElement) {
    if (resolveProp(n, 'display', width) === 'none') return false;
  }
  return true;
}

const INHERITED_PROPS = new Set([
  'color',
  'font-size',
  'font-family',
  'font-weight',
  'line-height',
  'visibility',
]);

/** Cascade-resolved value with inheritance: the element's own declaration
 *  wins; inheritable properties fall back up the ancestor chain and the
 *  result is var()-resolved against the light theme tokens. */
function cascadeProp(
  el: FakeElement,
  prop: string,
  width: number,
  vars: Map<string, string>,
): string {
  let v = resolveProp(el, prop, width);
  if (v === 'unset' && INHERITED_PROPS.has(prop)) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      v = resolveProp(n, prop, width);
      if (v !== 'unset') break;
    }
  }
  return v === 'unset' ? v : resolveVars(v, vars);
}

/* ---------- mounted-DOM harness ---------- */

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

const NOW = Date.now();
const SESSIONS: StoredChatSession[] = [
  {
    id: 's-active',
    title: '周末看展计划',
    updatedAt: NOW,
    messages: [
      { id: 'm1', role: 'user', content: '她周末答应出来了', createdAt: 1 },
    ],
  },
  {
    id: 's-old',
    title: '聊聊周末',
    updatedAt: NOW - 86_400_000,
    messages: [],
  },
];

const TRASH: TrashEntry[] = [
  {
    sessionId: 's-gone',
    title: '旧对话',
    messages: [],
    deletedAt: NOW - 172_800_000,
    messageCount: 2,
  },
];

const noop = () => {};

/** Everything a pointer can activate inside the aside: real buttons, the
 *  filter/rename inputs, links, the disclosure <summary>, and explicit
 *  button roles. Containers, lists and headings are not controls. */
function clickables(aside: FakeElement): FakeElement[] {
  return aside._walk().filter(
    (el) =>
      el.tagName === 'BUTTON' ||
      el.tagName === 'INPUT' ||
      el.tagName === 'SUMMARY' ||
      (el.tagName === 'A' && el.hasAttribute('href')) ||
      el.getAttribute('role') === 'button',
  );
}

describe('P378 · sidebar chrome density — borders, inset filter, one clear-all pill', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  let container: FakeElement;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (widthPx: number, mobile: boolean) => {
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
          profile: null,
          recentSessions: SESSIONS,
          activeSessionId: SESSIONS[0].id,
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

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const vp of [
    { width: 390, height: 844, mobile: true },
    { width: 1440, height: 900, mobile: false },
  ] as const) {
    describe(`${vp.width}×${vp.height}`, () => {
      it('at most 3 clickable elements inside .sidebar paint a visible border', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const offenders = clickables(aside).filter((el) =>
          paintsVisibleBorder(el, vp.width),
        );
        expect(
          offenders.length,
          `visible-bordered controls: ${offenders
            .map(
              (el) =>
                `${el.tagName}.${el.className}(${el.getAttribute('aria-label') ?? el.textContent.trim()})`,
            )
            .join(' | ')}`,
        ).toBeLessThanOrEqual(3);
        await unmount();
      });

      it('every [class*=filter] element resolves border-style:none and zero box-shadow layers', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const filterEls = aside
          ._walk()
          .filter((el) => el.className.includes('filter'));
        expect(
          filterEls.length,
          'the inset field family should be mounted',
        ).toBeGreaterThanOrEqual(3);
        for (const el of filterEls) {
          const { style } = borderBox(el, vp.width);
          expect(
            style,
            `${el.tagName}.${el.className} border-style`,
          ).toBe('none');
          expect(
            shadowLayers(el, vp.width),
            `${el.tagName}.${el.className} box-shadow layers`,
          ).toBe(0);
        }
        await unmount();
      });

      it('清空全部对话 is a secondary button whose title names the 回收站 and carries a glyph', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const btn = aside.querySelector(
          'button.recent-chat-clear-all',
        ) as FakeElement | null;
        expect(btn, 'clear-all button').not.toBeNull();
        expect(btn!.tagName).toBe('BUTTON');
        const title = btn!.getAttribute('title') ?? '';
        const aria = btn!.getAttribute('aria-label') ?? '';
        expect(
          `${title} ${aria}`,
          'clear-all role/title copy',
        ).toContain('移到回收站');
        expect(aria).toBe('清空全部对话');
        // Icon + pill, never bare text: an svg glyph rides the label and the
        // resting style is a soft fill with no frame.
        expect(btn!.querySelector('svg')).not.toBeNull();
        expect(
          resolveProp(btn!, 'background', vp.width) !== 'unset' ||
            resolveProp(btn!, 'background-color', vp.width) !== 'unset',
          'secondary pill should carry a soft fill',
        ).toBe(true);
        // P384: secondary means non-primary and non-bare — the fill is a
        // real painted colour (the walkthrough's defect was
        // `backgroundColor rgba(0,0,0,0)`) and it is NOT the brand accent.
        const vars = themeVarsFor(vp.width);
        const paint = ownPaint(btn!, vp.width, vars);
        expect(paint, 'clear-all fill must be a real colour').not.toBeNull();
        expect(paint!.a, 'clear-all fill must not be transparent').toBeGreaterThan(0);
        const accent = parseColor(resolveVars('var(--accent)', vars))!;
        const isBrandFill =
          Math.abs(paint!.r - accent.r) <= 8 &&
          Math.abs(paint!.g - accent.g) <= 8 &&
          Math.abs(paint!.b - accent.b) <= 8 &&
          paint!.a === accent.a;
        expect(isBrandFill, 'clear-all must not reuse the primary brand fill').toBe(false);
        await unmount();
      });

      it('快捷入口/进阶工具 rows and the 回收站 row resolve border-style:none', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const rows = aside
          ._walk()
          .filter(
            (el) =>
              el.classList.contains('quick-btn') ||
              el.classList.contains('tool-entry') ||
              el.classList.contains('recent-chat-trash'),
          );
        expect(rows.length).toBeGreaterThanOrEqual(10);
        for (const el of rows) {
          expect(
            borderBox(el, vp.width).style,
            `${el.tagName}.${el.className}`,
          ).toBe('none');
        }
        await unmount();
      });

      it('回收站 and 筛选对话 are not the same control: icon+chevron row vs magnifier inset field', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const trash = aside.querySelector(
          'button.recent-chat-trash',
        ) as FakeElement;
        expect(trash, 'trash row').not.toBeNull();
        expect(trash.querySelector('.sidebar-icon')).not.toBeNull();
        expect(trash.querySelector('.sidebar-chevron')).not.toBeNull();
        const wrap = aside.querySelector(
          '.recent-chat-filter-wrap',
        ) as FakeElement;
        expect(wrap, 'filter wrap').not.toBeNull();
        const field = wrap.querySelector('input.recent-chat-filter');
        expect(field, 'inset filter input').not.toBeNull();
        expect(field!.tagName).toBe('INPUT');
        expect(
          wrap.querySelector('.recent-chat-filter-icon'),
          'left magnifier inside the field row',
        ).not.toBeNull();
        // The field paints a hairline via background-image — visible, yet
        // neither a border nor a shadow.
        const bg = resolveProp(field!, 'background-image', vp.width);
        expect(bg).toContain('linear-gradient');
        await unmount();
      });

      it('进阶工具 folds into a <details> group, collapsed by default, every row mounted', async () => {
        await mount(vp.width, vp.mobile);
        const aside = qs('.sidebar')!;
        const details = aside.querySelector(
          'details.tools-details',
        ) as FakeElement | null;
        expect(details, 'tools disclosure group').not.toBeNull();
        expect(details!.tagName).toBe('DETAILS');
        // Collapsed at rest — no `open` attribute on first render.
        expect(details!.hasAttribute('open')).toBe(false);
        const summary = details!.querySelector('summary.tools-toggle');
        expect(summary, 'disclosure header').not.toBeNull();
        expect(summary!.querySelector('h3')!.textContent).toBe('进阶工具');
        // All five rows mounted inside the group — the list declares no
        // max-height, so the末项 can never be clipped open or closed.
        const list = details!.querySelector('ul.tool-list');
        expect(list).not.toBeNull();
        expect(
          list!.querySelectorAll('.tool-item').length,
        ).toBeGreaterThanOrEqual(TOOL_FALLBACK.length);
        expect(resolveProp(list!, 'max-height', vp.width)).toBe('unset');
        expect(resolveProp(list!, 'overflow', vp.width)).toBe('unset');
        expect(resolveProp(list!, 'overflow-y', vp.width)).toBe('unset');
        await unmount();
      });

      it('进阶工具 fold: closed rows own no layout box, opened rows carry painted labels', async () => {
        // P384 reproduce-check — walkthrough 1795109419 (390×844, Chromium):
        // inside a closed <details> the five rows still had 44px boxes and
        // a live offsetParent but painted nothing (innerText ''). The fold
        // is now a declared display:none — zero boxes, not just zero paint —
        // and an opened row must carry a non-empty, actually-painted label.
        await mount(vp.width, vp.mobile);
        const vars = themeVarsFor(vp.width);
        const aside = qs('.sidebar')!;
        const details = aside.querySelector(
          'details.tools-details',
        ) as FakeElement;
        const list = details.querySelector('ul.tool-list') as FakeElement;
        const rows = aside
          ._walk()
          .filter(
            (el) =>
              el.tagName === 'BUTTON' &&
              (el.getAttribute('aria-label') ?? '').startsWith('进阶工具：'),
          );
        expect(rows.length).toBeGreaterThanOrEqual(TOOL_FALLBACK.length);

        // Folded at rest: the list and every row inside it own no box.
        expect(resolveProp(list, 'display', vp.width)).toBe('none');
        for (const row of rows) {
          expect(
            laidOut(row, vp.width, aside),
            `${row.getAttribute('aria-label')} must not lay out while folded`,
          ).toBe(false);
        }

        // Opened (the disclosure click adds `open` in a real browser): each
        // row is laid out AND its label is painted — non-empty text at a
        // positive font size in an opaque, non-hidden colour, in a flex
        // slot that can widen past zero.
        details.setAttribute('open', '');
        expect(resolveProp(list, 'display', vp.width)).toBe('flex');
        for (const row of rows) {
          const name = row.getAttribute('aria-label')!;
          expect(laidOut(row, vp.width, aside), `${name} laid out`).toBe(true);
          const label = row.querySelector(
            '.sidebar-row-label',
          ) as FakeElement | null;
          expect(label, `${name} label span`).not.toBeNull();
          expect(
            label!.textContent.trim().length,
            `${name} label text`,
          ).toBeGreaterThanOrEqual(2);
          const fontSize = cascadeProp(label!, 'font-size', vp.width, vars);
          expect(
            parseFloat(fontSize),
            `${name} font-size ${fontSize}`,
          ).toBeGreaterThan(0);
          const colour = parseColor(
            cascadeProp(label!, 'color', vp.width, vars),
          );
          expect(colour, `${name} colour resolves`).not.toBeNull();
          expect(colour!.a, `${name} colour opaque`).toBeGreaterThan(0);
          expect(
            cascadeProp(label!, 'visibility', vp.width, vars),
            `${name} visibility`,
          ).not.toMatch(/hidden|collapse/);
          // The flex slot grows — the label can never be squeezed to a
          // zero-width clip while the row itself has width.
          expect(
            parseFloat(resolveProp(label!, 'flex', vp.width)),
            `${name} label flex-grow`,
          ).toBeGreaterThanOrEqual(1);
          expect(
            resolveProp(label!, 'display', vp.width),
            `${name} label display`,
          ).not.toBe('none');
          expect(
            row.querySelector('.sidebar-icon'),
            `${name} leading icon`,
          ).not.toBeNull();
          expect(
            row.querySelector('.sidebar-chevron'),
            `${name} trailing chevron`,
          ).not.toBeNull();
        }
        await unmount();
      });

      it('最近对话 is not one uniform grey stack: ≥2 distinguishable background luminances', async () => {
        // P384 verify — white-filled cards vs grey-filled rows must resolve
        // to at least two painted luminances. Effective paint walks up the
        // ancestor chain, so a transparent session row counts as the
        // sidebar's white surface, the clear-all pill as --surface-hover
        // grey, and the active card as accent-soft pink-on-white.
        await mount(vp.width, vp.mobile);
        const vars = themeVarsFor(vp.width);
        const section = qs('.sidebar')!.querySelector('.recent-chats') as FakeElement;
        expect(section, 'recent-chats section').not.toBeNull();
        const luminances = [section, ...section._walk()]
          .map((el) => effectivePaint(el, vp.width, vars))
          .filter((rgb): rgb is [number, number, number] => rgb !== null)
          .map(luminance);
        expect(luminances.length).toBeGreaterThan(0);
        const levels = new Set(
          luminances.map((l) => Math.round(l * 100)),
        );
        const spread = Math.max(...luminances) - Math.min(...luminances);
        expect(
          levels.size,
          `luminance levels ${[...levels].sort().join(', ')}`,
        ).toBeGreaterThanOrEqual(2);
        expect(spread, `luminance spread ${spread.toFixed(3)}`).toBeGreaterThanOrEqual(0.05);
        await unmount();
      });
    });
  }

  it('390×844: 完善资料 is a single layer — the bordered .profile-card shell is gone', async () => {
    await mount(390, true);
    const aside = qs('.sidebar')!;
    const btn = aside.querySelector('.profile-setup-btn') as FakeElement;
    expect(btn, '完善资料 entry').not.toBeNull();
    const section = btn.closest('section');
    expect(section).not.toBeNull();
    expect(section!.classList.contains('profile-card')).toBe(false);
    expect(borderBox(section!, 390).style).toBe('none');
    await unmount();
  });

  it('1440×900: the 完善资料 entry still does not render on the persistent aside (P342 gate)', async () => {
    await mount(1440, false);
    expect(qs('.profile-setup-btn')).toBeNull();
    await unmount();
  });
});
