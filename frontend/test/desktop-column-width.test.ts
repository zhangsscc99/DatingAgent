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
  type FakeDom,
} from './helpers/fakeDom';

/**
 * P305 — at 1440×900 the bubble column measured ~740 px while the composer
 * spanned the whole ~1130 px main area, so their left/right edges never
 * lined up, and a single exchange left half a screen of blank under it.
 * The fix introduces --column-max: .messages > * and the new .input-column
 * wrapper both resolve max-width through it, ::before/::after bookends in
 * .messages grow into the free space so short content lands vertically
 * centred, and nothing below the cap changes — the rules are
 * width:100%-based so ≤768px layout is byte-identical.
 * P311 narrowed the token 880→600 px and moved it inside a
 * (min-width: 769px) :root block, so the variable is undefined under the
 * mobile breakpoint and every reference falls back to its pre-column
 * value (desktop-measure.test.ts pins the new reading-column geometry).
 *
 * No DOM renderer ships with this repo, so "widths differ by ≤ 8 px" is
 * asserted on the resolved CSS values (computed-style source level), plus a
 * mounted-App check that the composer really nests its controls inside
 * .input-column.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const indexCss = read('index.css');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');
const bubbleCss = read('components/MessageBubble.css');
const skeletonCss = read('components/SessionSkeleton.css');
const inputBarTsx = read('components/InputBar.tsx');

/** Slice the body of `@media <query> { … }` with brace matching. */
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

/** Strip every @media block so only top-level rules remain. */
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

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

/** Resolve a `max-width:` declaration to px, following var(--name) once. */
function resolveMaxWidthPx(rule: string, css: string): number | null {
  const decl = /max-width:\s*([^;]+)/.exec(rule)?.[1].trim();
  if (!decl) return null;
  const px = /^([0-9.]+)px$/.exec(decl);
  if (px) return parseFloat(px[1]);
  const varRef = /^var\((--[\w-]+)\)$/.exec(decl);
  if (varRef) {
    const value = new RegExp(
      `${varRef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([0-9.]+)px`,
    ).exec(css);
    return value ? parseFloat(value[1]) : null;
  }
  return null;
}

const columnMaxRaw = /--column-max:\s*([0-9.]+)px/.exec(indexCss)?.[1];
const columnMax = columnMaxRaw ? parseFloat(columnMaxRaw) : null;

describe('P305 · shared centred column', () => {
  it('defines a single --column-max token, declared for desktop only', () => {
    expect(columnMax).not.toBeNull();
    // P311: the column is capped for CJK line length — the full geometry
    // is pinned in desktop-measure.test.ts.
    expect(columnMax!).toBeGreaterThanOrEqual(520);
    expect(columnMax!).toBeLessThanOrEqual(680);
    // The token lives inside the ≥769px :root block so it is undefined
    // under the mobile breakpoint and every var() reference keeps its
    // pre-column fallback.
    const desktop = mediaBlock(indexCss, '(min-width: 769px)');
    expect(ruleBody(desktop, ':root')).toContain('--column-max');
    expect(topLevel(indexCss)).not.toMatch(/--column-max:\s*[0-9.]+px/);
  });

  it('the message scroll area constrains every row to the shared column', () => {
    const rule = ruleBody(topLevel(chatWindowCss), '.messages > *');
    expect(rule).not.toBe('');
    expect(rule).toContain('width: 100%');
    expect(resolveMaxWidthPx(rule, indexCss)).toBe(columnMax);
    expect(rule).toContain('margin-left: auto');
    expect(rule).toContain('margin-right: auto');
  });

  it('the composer wraps its controls in .input-column on the same column', () => {
    const rule = ruleBody(topLevel(inputBarCss), '.input-column');
    expect(rule).not.toBe('');
    expect(resolveMaxWidthPx(rule, indexCss)).toBe(columnMax);
    expect(rule).toContain('margin-left: auto');
    expect(rule).toContain('margin-right: auto');
    // The wrap/gap/align layout moved off .input-bar onto the wrapper.
    expect(rule).toContain('flex-wrap: wrap');
  });

  it('message column and composer column widths differ by ≤ 8 px', () => {
    const messageWidth = resolveMaxWidthPx(
      ruleBody(topLevel(chatWindowCss), '.messages > *'),
      indexCss,
    );
    const composerWidth = resolveMaxWidthPx(
      ruleBody(topLevel(inputBarCss), '.input-column'),
      indexCss,
    );
    expect(messageWidth).not.toBeNull();
    expect(composerWidth).not.toBeNull();
    expect(Math.abs(messageWidth! - composerWidth!)).toBeLessThanOrEqual(8);
  });

  it('bubble rows and the restore skeleton ride the same column', () => {
    expect(
      resolveMaxWidthPx(ruleBody(bubbleCss, '.bubble-row'), indexCss),
    ).toBe(columnMax);
    expect(
      resolveMaxWidthPx(ruleBody(skeletonCss, '.skeleton-row'), indexCss),
    ).toBe(columnMax);
  });

  it('short content is vertically centred via growing bookends', () => {
    const rule = ruleBody(
      topLevel(chatWindowCss),
      '.messages::before,\n.messages::after',
    ) || ruleBody(topLevel(chatWindowCss), '.messages::before, .messages::after');
    expect(rule).not.toBe('');
    expect(rule).toContain("content: ''");
    expect(rule).toMatch(/flex:\s*1\b/);
  });

  it('the pending-reply row packs its content at the column edge', () => {
    const rule = ruleBody(chatWindowCss, '.pending-reply-row');
    expect(rule).toContain('justify-content: flex-end');
  });

  it('the narrow-screen rules are untouched', () => {
    // ≤768px keeps its own padding/typography; the column rule is not
    // re-gated per breakpoint and no mobile block introduces a narrower cap.
    const narrow = mediaBlock(inputBarCss, '(max-width: 768px)');
    expect(narrow).not.toContain('input-column');
    expect(narrow).not.toContain('max-width');
    const narrowChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
    expect(narrowChat).not.toContain('column-max');
  });
});

describe('P305 · composer column in the live tree', () => {
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

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('input-field, input-tools and the hint row all live inside .input-column', async () => {
    dom = installFakeDom();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') return jsonResponse({ status: 'ok' });
        return jsonResponse({ ok: true });
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();

    const column = qs('.input-column');
    expect(column, 'the centred composer column').toBeTruthy();
    // The fake DOM only supports single-compound selectors — assert the
    // parent link instead of a descendant query.
    expect(
      (column!.parentElement as FakeElement | null)?.classList.contains(
        'input-bar',
      ),
    ).toBe(true);
    expect(column!.querySelector('.input-field')).toBeTruthy();
    expect(column!.querySelector('.input-tools')).toBeTruthy();
    expect(column!.querySelector('.busy-enter-hint')).toBeTruthy();
    // The textarea itself sits inside the column, not beside it.
    expect(column!.querySelector('#chat-input')).toBeTruthy();

    // Source-level: the wrapper is opened before the field and closed
    // after .busy-enter-hint inside .input-bar. (The field div carries
    // className={fieldClass}, so it is matched by expression, not literal.)
    const open = inputBarTsx.indexOf('className="input-column"');
    expect(open).toBeGreaterThan(-1);
    expect(inputBarTsx.indexOf('className={fieldClass}', open)).toBeGreaterThan(
      open,
    );
    expect(inputBarTsx.indexOf('input-tools', open)).toBeGreaterThan(open);
    expect(inputBarTsx.indexOf('busy-enter-hint', open)).toBeGreaterThan(open);

    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  });
});
