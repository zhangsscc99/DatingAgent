/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { CLEAR_ALL_LABEL } from '../src/lib/copy';

/**
 * P389 — measured at 1795109419 / 1795115528 (390×844 and 1440×900): the
 * sidebar's 清空全部对话 was a light-grey pill with a grey trash icon
 * (color rgb(74,74,88) / bg rgb(240,240,245)) while the SAME action in
 * settings was red rgb(201,42,42) — one destructive operation speaking
 * two danger languages — and it sat on the 最近对话 heading row, one
 * stray tap away from the section title.
 *
 * The fix: both entry points now carry `data-tone="danger"` and read the
 * single `button[data-tone='danger']` rule in index.css (one --danger
 * source of truth); the sidebar button moved to the END of the 最近对话
 * list (after the last chat row, before the 回收站 entry); and the click
 * still opens the shared ConfirmDialog whose copy names the 回收站.
 *
 * Harness: the real App mounted on the fake DOM (same as
 * settings-parity.test.ts). The fake DOM ships no CSS engine, so the
 * real stylesheets are parsed and resolved against the tree with
 * media-query gating — the same resting-state resolver
 * sidebar-chrome-density.test.ts runs — and "top > heading bottom" is
 * asserted as DOM order inside a plain block/flex column flow (no
 * out-of-flow positioning, no negative offsets), which is what a real
 * layout engine would compute.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SHEETS = [
  'index.css',
  'components/Sidebar.css',
  'components/SettingsSheet.css',
  'components/ConfirmDialog.css',
];

/* ---------- resting-state stylesheet resolver (same as sidebar-chrome-density) ---------- */

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

/** RESTING compound match — any pseudo (`:hover`, `:focus-visible`,
 *  `:not(...)`) means the rule describes a state, never the resting box.
 *  With `anyState` the same matcher instead evaluates what WOULD apply in
 *  a state: `:not(X)` is honoured (el must not match X) while
 *  `:hover`/`:focus*`/etc are treated as satisfied — P401's ring check. */
function compoundMatches(
  el: FakeElement,
  compound: string,
  anyState = false,
): boolean {
  let rest = compound.trim();
  if (!rest) return false;
  while (rest.length > 0) {
    if (rest[0] === '*') {
      rest = rest.slice(1);
      continue;
    }
    if (rest[0] === ':') {
      if (!anyState) return false;
      if (rest.startsWith(':not(')) {
        const end = rest.indexOf(')');
        if (end < 0 || compoundMatches(el, rest.slice(5, end))) return false;
        rest = rest.slice(end + 1);
        continue;
      }
      const state =
        /^:(focus-visible|focus-within|focus|hover|active|disabled|checked)/.exec(
          rest,
        );
      if (!state) return false;
      rest = rest.slice(state[0].length);
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

function selectorMatches(
  el: FakeElement,
  selector: string,
  anyState = false,
): boolean {
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
  if (!compoundMatches(el, compounds[compounds.length - 1], anyState))
    return false;
  let node: FakeElement | null = el;
  for (let i = compounds.length - 2; i >= 0; i--) {
    const comb = combinators[i];
    if (comb === 'sib') return false;
    if (comb === 'child') {
      node = node.parentElement;
      if (!node || !compoundMatches(node, compounds[i], anyState))
        return false;
    } else {
      let a: FakeElement | null = node.parentElement;
      while (a && !compoundMatches(a, compounds[i], anyState))
        a = a.parentElement;
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

/** Winning declaration of `prop` for `el` at `width` px — 'unset' when no
 *  matching rule declares it. Pseudo-bearing rules never match. */
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

/** Declarations of `prop` from every rule carrying a state pseudo whose
 *  selector matches `el` at `width` px — what hover/focus WOULD paint,
 *  where resolveProp above only ever reports the resting box. */
function stateDecls(el: FakeElement, prop: string, width: number): string[] {
  const out: string[] = [];
  for (const rule of RULES) {
    if (width < rule.minWidth || width > rule.maxWidth) continue;
    const v = declOf(rule.body, prop);
    if (v === null) continue;
    for (const s of rule.selectors) {
      if (s.includes(':') && selectorMatches(el, s, true)) {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

/* ---------- theme vars / colour ---------- */

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
    const a =
      fn[4] === undefined
        ? 1
        : fn[4].endsWith('%')
          ? Number(fn[4].slice(0, -1)) / 100
          : Number(fn[4]);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a };
  }
  return null;
}

/** The resolved `color` an element computes to — the getComputedStyle()
 *  equivalent for this DOM-less harness. */
function computedColor(el: FakeElement, width: number): string {
  const vars = themeVarsFor(width);
  return resolveVars(resolveProp(el, 'color', width), vars).trim();
}

/* ---------- mounted-App harness (same as settings-parity.test.ts) ---------- */

function mediaQueryFor(narrow: boolean) {
  return (q: string) => ({
    matches: narrow ? q === '(max-width: 768px)' : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

const STORED_SESSION = {
  activeSessionId: 's-p389',
  sessions: [
    {
      id: 's-p389',
      title: '周末邀约',
      updatedAt: 1000,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '她今天答应周末出来了，第一句要说什么？',
          createdAt: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: '恭喜你！可以先轻松回应她的兴趣点。',
          createdAt: 2,
        },
      ],
    },
  ],
};

/** A stored state holding `n` sessions (2 messages each) — used by the
 *  P416 multi-session case so the dialog has to say 「清空全部 n 段对话」. */
const storedSessionsFor = (n: number) => ({
  activeSessionId: 's-p416-0',
  sessions: Array.from({ length: n }, (_, i) => ({
    id: `s-p416-${i}`,
    title: `会话 ${i + 1}`,
    updatedAt: 1000 + i,
    messages: [
      { id: `m-${i}-1`, role: 'user', content: '在吗', createdAt: 1 },
      { id: `m-${i}-2`, role: 'assistant', content: '在的，怎么了？', createdAt: 2 },
    ],
  })),
});

describe('P389 · sidebar 清空全部对话 shares the danger language and leaves the heading row', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const mountApp = async () => {
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  const install = (narrow: boolean, withSession: boolean, sessionCount = 1) => {
    dom = installFakeDom();
    const mq = mediaQueryFor(narrow);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    (dom.window as Record<string, unknown>).innerWidth = narrow ? 390 : 1440;
    (dom.window as Record<string, unknown>).innerHeight = narrow ? 844 : 900;
    vi.stubGlobal('matchMedia', mq);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        if (url === '/api/version') {
          return jsonResponse({ version: '1.0.0', gitSha: 'abc1234' });
        }
        return jsonResponse({ ok: true });
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
    if (withSession) {
      dom.localStorage.setItem(
        'datingAgent.chatHistory',
        JSON.stringify(
          sessionCount > 1 ? storedSessionsFor(sessionCount) : STORED_SESSION,
        ),
      );
    }
  };

  /** On a phone the drawer must be opened first; on desktop the aside is
   *  already up. Returns the sidebar clear-all button. */
  const openDrawerAndFindClearAll = async (narrow: boolean) => {
    if (narrow) {
      await click(qs('.menu-btn'));
      await flush();
    }
    return qs('.recent-chat-clear-all') as FakeElement | null;
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const narrow of [true, false]) {
    const w = narrow ? 390 : 1440;
    it(`${w}px — both 清空全部对话 entries resolve the SAME danger colour and share data-tone="danger"`, async () => {
      install(narrow, true);
      await mountApp();
      const sidebarBtn = await openDrawerAndFindClearAll(narrow);
      expect(sidebarBtn, 'sidebar clear-all').not.toBeNull();
      await click(qs('.settings-open-btn'));
      await flush();
      const settingsBtn = qs('.settings-data-btn.danger') as FakeElement | null;
      expect(settingsBtn, 'settings clear-all').not.toBeNull();
      await unmountApp();

      // The semantic marker is shared…
      expect(sidebarBtn!.getAttribute('data-tone')).toBe('danger');
      expect(settingsBtn!.getAttribute('data-tone')).toBe('danger');
      // …and so is the computed colour: identical on both surfaces and
      // equal to the one --danger token (light theme #c92a2a → 201,42,42).
      const sidebarColor = computedColor(sidebarBtn!, w);
      const settingsColor = computedColor(settingsBtn!, w);
      const dangerToken = resolveVars('var(--danger)', themeVarsFor(w));
      expect(sidebarColor).toBe(settingsColor);
      expect(sidebarColor).toBe(dangerToken);
      const rgb = parseColor(sidebarColor);
      expect(rgb, 'danger colour parses').not.toBeNull();
      // Danger range: strongly red-dominant, low green/blue.
      expect(rgb!.r).toBeGreaterThan(150);
      expect(rgb!.g).toBeLessThan(100);
      expect(rgb!.b).toBeLessThan(100);
    });
  }

  it('390×844 — the sidebar button sits BELOW the 最近对话 heading, at the end of the list', async () => {
    install(true, true);
    await mountApp();
    await openDrawerAndFindClearAll(true);
    const aside = qs('.sidebar')!;
    const heading = aside.querySelector('.recent-chats-header')!;
    const btn = aside.querySelector('.recent-chat-clear-all')!;
    const list = aside.querySelector('.recent-chat-list')!;
    const rows = aside._walk().filter((el) =>
      el.classList.contains('recent-chat-row'),
    );
    expect(rows.length).toBeGreaterThan(0);

    // DOM order inside a plain vertical flow IS vertical order: the
    // button comes after the heading AND after the last chat row, so its
    // top is strictly below the heading's bottom — the walkthrough's
    // "sits on the same row as 最近对话" defect.
    const order = aside._walk();
    expect(order.indexOf(btn)).toBeGreaterThan(order.indexOf(heading));
    expect(order.indexOf(btn)).toBeGreaterThan(
      order.indexOf(rows[rows.length - 1]),
    );
    expect(order.indexOf(btn)).toBeGreaterThan(order.indexOf(list));

    // …and it is no longer inside the heading row at all.
    for (let n: FakeElement | null = btn; n && n !== aside; n = n.parentElement) {
      expect(n.classList.contains('recent-chats-header')).toBe(false);
    }

    // Nothing takes it out of flow or drags it back up: no absolute/fixed
    // positioning, no negative top, no transform, no negative margin.
    for (const prop of ['position', 'top', 'bottom', 'transform']) {
      const v = resolveProp(btn, prop, 390);
      expect(
        ['unset', 'static', 'relative', 'none', '0', 'auto'].includes(v) ||
          (prop === 'position' && v === 'unset'),
        `${prop} must not pull the button out of flow (got ${v})`,
      ).toBe(true);
    }
    const marginTop = resolveVars(
      resolveProp(btn, 'margin-top', 390),
      themeVarsFor(390),
    ).trim();
    if (marginTop !== 'unset') {
      expect(Number(marginTop.replace('px', ''))).toBeGreaterThanOrEqual(0);
    }
    await unmountApp();
  });

  it('390×844 — activating it opens the shared confirm whose copy names the 回收站', async () => {
    install(true, true);
    await mountApp();
    const btn = await openDrawerAndFindClearAll(true);
    expect(btn!.getAttribute('aria-label')).toBe(CLEAR_ALL_LABEL);
    await click(btn);
    await flush();
    const dialog = qs('[role="alertdialog"]') as FakeElement | null;
    expect(dialog, 'shared ConfirmDialog').not.toBeNull();
    // The description names the count AND the trash destination — no
    // second confirm implementation, same builder as the settings entry.
    const text = dialog!.textContent;
    expect(text).toContain('回收站');
    expect(text).toContain('1 段对话');
    expect(text).toContain('移到回收站');
    // P416: the dialog speaks the counted scope end to end — heading and
    // button both say 「清空 1 段对话」, never the entry-point's bare
    // 「清空全部对话」.
    expect(text).toContain('清空 1 段对话');
    await unmountApp();
  });

  it('390×844 — P401: panel holds mount focus, 取消 keeps no brand ring, title and body agree, buttons sit ≥12px apart', async () => {
    install(true, true);
    await mountApp();
    const btn = await openDrawerAndFindClearAll(true);
    await click(btn);
    await flush();
    const dialog = qs('[role="alertdialog"]') as FakeElement | null;
    expect(dialog, 'shared ConfirmDialog').not.toBeNull();
    const buttons = dialog!
      ._walk()
      .filter((el) => el.classList.contains('confirm-btn'));
    const cancel = buttons.find((el) => !el.classList.contains('danger'));
    const danger = buttons.find((el) => el.classList.contains('danger'));
    expect(cancel, '取消 button').toBeTruthy();
    expect(danger, 'danger button').toBeTruthy();

    // (1) Mount focus is the panel — never the cancel button that used to
    // open already wearing the ring (and never the danger button either).
    expect(dom.document.activeElement).not.toBe(cancel);
    expect(dom.document.activeElement).not.toBe(danger);
    expect(dom.document.activeElement).toBe(qs('.confirm-panel'));

    // (2) 取消 carries no brand ring. The brand is --accent #d81b74 =
    // rgb(216,27,116) — banned from its boxShadow entirely and from any
    // outline/shadow a hover or keyboard-focus state could paint.
    const vars = themeVarsFor(390);
    const brand = /#d81b74|216,\s*27,\s*116|--accent|--brand|accent-glow/i;
    const restingShadow = resolveVars(
      resolveProp(cancel!, 'box-shadow', 390),
      vars,
    );
    expect(restingShadow).not.toMatch(brand);
    expect(
      getComputedStyle(cancel as unknown as Element).getPropertyValue(
        'box-shadow',
      ),
    ).not.toMatch(brand);
    for (const prop of ['box-shadow', 'outline', 'outline-color']) {
      for (const raw of stateDecls(cancel!, prop, 390)) {
        expect(
          resolveVars(raw, vars),
          `state ${prop}: ${raw} must not use the brand colour`,
        ).not.toMatch(brand);
      }
    }
    // A neutral outline on keyboard focus is allowed — but it must exist
    // as a state declaration and stay non-brand (checked above).
    expect(stateDecls(cancel!, 'outline', 390).length).toBeGreaterThan(0);

    // (3) The title states the same count the body does — one source of
    // truth, so 「清空全部对话」 can never sit above 「将把 1 段对话」 again.
    const title = qs('.confirm-title')!;
    const desc = qs('.confirm-desc')!;
    expect(title.textContent).toMatch(/清空 (全部 \d+ 段|\d+ 段)对话/);
    const titleCount = Number(/(\d+) 段/.exec(title.textContent)![1]);
    const bodyCount = Number(/将把 (\d+) 段对话/.exec(desc.textContent)![1]);
    expect(titleCount).toBe(bodyCount);

    // (4) ≥12px of horizontal separation: both buttons are the flex row's
    // only children, cancel first, and the resolved gap meets the floor.
    const actions = qs('.confirm-actions')!;
    expect(cancel!.parentElement).toBe(actions);
    expect(danger!.parentElement).toBe(actions);
    const rowButtons = actions._walk().filter((el) => el.tagName === 'BUTTON');
    expect(rowButtons.length).toBe(2);
    expect(rowButtons[0]).toBe(cancel);
    expect(rowButtons[1]).toBe(danger);
    expect(resolveProp(actions, 'display', 390)).toBe('flex');
    const px = (v: string) =>
      Number(/([\d.]+)px/.exec(resolveVars(v, vars))?.[1] ?? '0');
    const gap = Math.max(
      px(resolveProp(actions, 'gap', 390)),
      px(resolveProp(actions, 'column-gap', 390)),
    );
    expect(gap).toBeGreaterThanOrEqual(12);

    await unmountApp();
  });

  for (const sessionCount of [1, 3]) {
    it(`390×844 — P416: confirm button repeats the heading's counted scope (${sessionCount} session${sessionCount > 1 ? 's' : ''})`, async () => {
      install(true, true, sessionCount);
      await mountApp();
      const btn = await openDrawerAndFindClearAll(true);
      // The sidebar entry point keeps its fixed CLEAR_ALL_LABEL — only the
      // in-dialog confirm button follows the counted scope.
      expect(btn!.getAttribute('aria-label')).toBe(CLEAR_ALL_LABEL);
      await click(btn);
      await flush();
      const dialog = qs('[role="alertdialog"]') as FakeElement | null;
      expect(dialog, 'shared ConfirmDialog').not.toBeNull();
      const danger = dialog!
        ._walk()
        .find((el) => el.classList.contains('danger'))!;
      const heading = qs('.confirm-title')!;
      // The button states a counted scope just like the heading…
      const scope = /清空 ?(全部 )?(\d+) 段对话/;
      expect(danger.textContent.trim()).toMatch(scope);
      // …and the number on the button IS the number in the heading —
      // compare parsed digits so the two can never drift again.
      const buttonCount = Number(scope.exec(danger.textContent)![2]);
      const headingCount = Number(/(\d+) 段/.exec(heading.textContent)![1]);
      expect(buttonCount).toBe(headingCount);
      expect(buttonCount).toBe(sessionCount);
      await unmountApp();
    });
  }

  it('still only renders when at least one chat exists (P270 gate preserved)', async () => {
    install(true, false);
    await mountApp();
    await click(qs('.menu-btn'));
    await flush();
    expect(qs('.recent-chat-clear-all')).toBeNull();
    await unmountApp();
  });
});
