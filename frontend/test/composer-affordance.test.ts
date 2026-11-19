/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
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
import InputBar from '../src/components/InputBar';

/**
 * P385 — measured at 1795101019 (walk-1795101019-d1.png): with an empty
 * composer the send key rendered as the same brand-magenta solid as its
 * enabled state — no disabled read at all — and the 「回答适中」 pill
 * looked like a button but carried no dropdown affordance, so its picker
 * semantics were invisible. Control affordance has to match effect: a
 * key that does nothing when pressed must look inert, and an option
 * picker must announce its popup.
 *
 * Contract asserted here, mounted at both 390×844 and 1440×900:
 *  1. Empty input → `.input-send` renders `disabled === true`; its
 *     resolved background differs from the enabled fill (luminance delta
 *     ≥ 0.15 — var(--surface-hover) vs var(--accent) — and the disabled
 *     rule also carries opacity 0.4 < 0.6 plus `cursor: not-allowed`).
 *     Typing restores the enabled brand-solid state.
 *  2. The 「回答适中」 trigger carries the picker affordance:
 *     `aria-haspopup="listbox"` + `aria-expanded` on the button and a
 *     chevron child node.
 *
 * The fake DOM ships no layout/CSS engine, so the computed-style half is
 * resolved from the real stylesheets the way hero-single-cta.test.ts and
 * composer-layout.test.ts resolve tokens.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const inputBarCss = read('components/InputBar.css');
const indexCss = read('index.css');

/* ---------- stylesheet resolution helpers (hero-single-cta.test.ts) ---------- */

/** Concatenate the declaration bodies of every `selector { … }` rule. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((m) => m[1])
    .join('\n');
}

function declaredProperty(css: string, selector: string, prop: string): string {
  const body = ruleBody(css, selector);
  const m = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body);
  expect(m, `${selector} should declare ${prop}`).toBeTruthy();
  return m![1].trim();
}

/** `--name: value;` declarations inside one `{ … }` body. */
function cssVars(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/--[a-z-]+\s*:\s*([^;]+);/g)) {
    vars.set(m[0].split(':')[0].trim(), m[1].trim());
  }
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

function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(m, `expected a #rrggbb color, got "${hex}"`).toBeTruthy();
  const n = parseInt(m![1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  return (
    0.2126 * channel(r / 255) +
    0.7152 * channel(g / 255) +
    0.0722 * channel(b / 255)
  );
}

const LIGHT_VARS = (() => {
  const m = /:root\s*\{([^}]*)\}/.exec(indexCss);
  expect(m, ':root light block').toBeTruthy();
  return cssVars(m![1]);
})();

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

const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [390, 844],
  [1440, 900],
];

describe('P385 · composer affordance — disabled send key + picker pill', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (widthPx: number, heightPx: number) => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(widthPx);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    (dom.window as Record<string, unknown>).innerWidth = widthPx;
    (dom.window as Record<string, unknown>).innerHeight = heightPx;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(InputBar, {
          onSend: () => {},
          replyLength: 'default' as const,
          onReplyLengthChange: () => {},
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

  for (const [w, h] of VIEWPORTS) {
    it(`${w}×${h}: empty input renders .input-send disabled`, async () => {
      await mount(w, h);
      const send = qs('.input-send');
      expect(send, 'composer send key').not.toBeNull();
      expect(send!.disabled).toBe(true);
      expect(send!.getAttribute('disabled')).not.toBeNull();
      await unmount();
    });

    it(`${w}×${h}: typing restores the enabled send key`, async () => {
      await mount(w, h);
      const ta = qs('textarea');
      expect(ta).not.toBeNull();
      await act(async () => {
        ta!.value = '帮我回一句';
        ta!.dispatchEvent(new FakeEvent('input', { bubbles: true }));
      });
      const send = qs('.input-send')!;
      expect(send.disabled).toBe(false);
      expect(send.getAttribute('disabled')).toBeNull();
      await unmount();
    });

    it(`${w}×${h}: 「回答适中」 carries the picker affordance`, async () => {
      await mount(w, h);
      const pill = qs('.reply-length-toggle');
      expect(pill, 'the 「回答适中」 reply-length trigger').not.toBeNull();
      expect(pill!.textContent).toContain('回答适中');
      // Dropdown semantics: haspopup marks it as a popup-backed picker…
      expect(pill!.getAttribute('aria-haspopup')).toBe('listbox');
      expect(pill!.hasAttribute('aria-expanded')).toBe(true);
      // …and the chevron child makes the affordance visible on screen.
      const chevron = pill!.querySelector('.reply-length-chevron');
      expect(chevron, 'chevron child inside the pill').not.toBeNull();
      expect(chevron!.getAttribute('aria-hidden')).toBe('true');
      await unmount();
    });
  }

  it('resolved disabled fill differs from the enabled brand solid', () => {
    // The mounted half pins `disabled === true`; the fake DOM reports no
    // computed styles, so the rendered backgroundColor is resolved from
    // the stylesheet — the same values a real engine computes.
    const enabledBg = resolveColor(
      LIGHT_VARS,
      declaredProperty(inputBarCss, '.input-bar .input-send', 'background'),
    );
    expect(enabledBg).toBe('#d81b74'); // var(--accent) — the brand magenta
    const disabledBody = ruleBody(inputBarCss, '.input-bar .input-send:disabled');
    expect(disabledBody, 'a dedicated :disabled rule').not.toBe('');
    const disabledBg = resolveColor(
      LIGHT_VARS,
      declaredProperty(inputBarCss, '.input-bar .input-send:disabled', 'background'),
    );
    const delta = Math.abs(luminance(enabledBg) - luminance(disabledBg));
    const opacity = /opacity\s*:\s*([\d.]+)/.exec(disabledBody);
    const alpha = opacity ? Number(opacity[1]) : 1;
    // Acceptance: luminance delta ≥ 0.15 OR effective alpha < 0.6 —
    // both hold (grey fill at ~0.87 vs magenta ~0.16, plus opacity 0.4).
    expect(
      delta >= 0.15 || alpha < 0.6,
      `enabled ${enabledBg} vs disabled ${disabledBg}: Δlum ${delta.toFixed(
        3,
      )}, opacity ${alpha}`,
    ).toBe(true);
    expect(disabledBody).toContain('cursor: not-allowed');
  });
});
