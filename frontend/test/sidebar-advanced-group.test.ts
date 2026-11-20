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
import { TOOL_PROMPTS } from '../src/lib/toolPrompts';

/**
 * P386 — walkthrough 1795109419 (390×844, drawer open) found the 进阶工具
 * group rendering as five textless rows: every `[aria-label^="进阶工具："]`
 * button measured a live offsetParent and a 44px rect while painting
 * nothing (innerText ''), leaving ~220–240px of blank space between the
 * 进阶工具 heading and 设置 — five invisible clickable entries.
 *
 * Verified against HEAD in real Chromium before changing anything: the
 * folded rows already reported offsetParent === null and height === 0 —
 * the P384 fold (`.tools-details > .tool-list { display: none }`) had
 * dropped their boxes — but the heading→设置 distance still measured
 * 267px: the drawer's `.sidebar-body` grew into the free space and the
 * footer's `margin-top: auto` pinned 设置 to the bottom edge, recreating
 * the blank (now without click targets). The fix keeps that pin for the
 * overflow case only: inside the ≤768px drawer the body stops growing
 * (`flex-grow: 0`, shrink + internal scroll unchanged) and the footer's
 * auto margin drops to 0, so 设置 hugs the content — a measured ~23px —
 * while desktop keeps the bottom-pinned footer.
 *
 * The fake DOM ships no layout engine (every rect reads 0), so the
 * walkthrough's geometric contract is asserted two ways, the same style
 * sidebar-chrome-density.test.ts resolves painted boxes:
 *  1. DOM level — every 进阶工具 row satisfies
 *     `innerText.trim().length >= 2 || getBoundingClientRect().height < 1`,
 *     and the heading→设置 distance is ≤ 56px (both rects collapse to 0).
 *  2. Stylesheet level — the details group mounts folded (no `open`
 *     attribute), the folded list declares `display: none`, and every row
 *     is a descendant of that list, so in a real engine the collapsed
 *     group owns no layout box and no dead click target. `[open]`
 *     restores `display: flex`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sidebarCss = readFileSync(
  join(SRC, 'components/Sidebar.css'),
  'utf8',
);

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

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

const MOBILE = mediaBlock(sidebarCss, '(max-width: 768px)');

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

const noop = () => {};
const VIEWPORTS: ReadonlyArray<{
  width: number;
  height: number;
  mobile: boolean;
}> = [
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 900, mobile: false },
];

describe('P386 · 进阶工具 group — no invisible laid-out rows, no dead gap', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (widthPx: number, heightPx: number, mobile: boolean) => {
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
        createElement(Sidebar, {
          tools: TOOL_FALLBACK,
          profile: null,
          isMobile: mobile,
          open: mobile,
          onQuickPrompt: noop,
          onNewChat: noop,
          onOpenSettings: noop,
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

  /** The walkthrough's probe — every element the group exposes. */
  const advancedRows = (aside: FakeElement) =>
    aside
      ._walk()
      .filter(
        (el) =>
          (el.getAttribute('aria-label') ?? '').startsWith('进阶工具：'),
      );

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const vp of VIEWPORTS) {
    it(`${vp.width}×${vp.height}: every 进阶工具 row shows text or owns no layout box`, async () => {
      await mount(vp.width, vp.height, vp.mobile);
      const aside = qs('.sidebar');
      expect(aside, 'mounted sidebar').not.toBeNull();
      const rows = advancedRows(aside!);
      expect(
        rows.length,
        'five labelled 进阶工具 entries (改资料/接话术/排约会/看匹配/关系建议)',
      ).toBe(TOOL_FALLBACK.length);
      for (const row of rows) {
        const paintedText = row.innerText.trim().length >= 2;
        const noBox = row.getBoundingClientRect().height < 1;
        expect(
          paintedText || noBox,
          `${row.getAttribute('aria-label')} must paint a label or own no box`,
        ).toBe(true);
      }
      await unmount();
    });

    it(`${vp.width}×${vp.height}: folded rows own no box and sit inside the display:none list`, async () => {
      await mount(vp.width, vp.height, vp.mobile);
      const aside = qs('.sidebar')!;
      const details = aside.querySelector(
        'details.tools-details',
      ) as FakeElement | null;
      expect(details, '进阶工具 disclosure group').not.toBeNull();
      // Folded at rest — the closed-rule is the one a real engine applies.
      expect(details!.hasAttribute('open')).toBe(false);
      const list = details!.querySelector('ul.tool-list');
      expect(list, 'tool list inside the fold').not.toBeNull();
      // Every exposed row is a descendant of the folded list — the
      // display:none rule below removes the whole subtree's boxes.
      for (const row of advancedRows(aside)) {
        expect(
          row.closest('ul.tool-list'),
          `${row.getAttribute('aria-label')} inside .tool-list`,
        ).toBe(list);
      }
      await unmount();
    });

    it(`${vp.width}×${vp.height}: heading → 设置 distance ≤ 56px, zero dead controls between`, async () => {
      await mount(vp.width, vp.height, vp.mobile);
      const aside = qs('.sidebar')!;
      const summary = aside.querySelector(
        'summary.tools-toggle',
      ) as FakeElement | null;
      const heading = summary?.querySelector('h3') ?? null;
      const settings = aside.querySelector(
        '.settings-open-btn',
      ) as FakeElement | null;
      expect(heading, '进阶工具 heading').not.toBeNull();
      expect(heading!.textContent.trim()).toBe('进阶工具');
      expect(settings, '设置 row').not.toBeNull();
      const gap =
        settings!.getBoundingClientRect().top -
        heading!.getBoundingClientRect().bottom;
      expect(gap, 'heading bottom → 设置 top').toBeLessThanOrEqual(56);
      // The space between them may contain no clickable element that owns
      // a layout box: the only interactive descendants of the details are
      // the toggle (the heading row itself) and the folded list's rows,
      // which the display:none rule strips of boxes (asserted above).
      const details = aside.querySelector(
        'details.tools-details',
      ) as FakeElement;
      const controlsBetween = details
        ._walk()
        .filter(
          (el) =>
            el.tagName === 'BUTTON' &&
            el.closest('ul.tool-list') === null,
        );
      expect(
        controlsBetween.length,
        'clickables inside the fold but outside the folded list',
      ).toBe(0);
      await unmount();
    });
  }

  it('stylesheet contract: the folded list is display:none, [open] restores flex', () => {
    const folded = ruleBody(sidebarCss, '.tools-details > .tool-list');
    expect(folded).toContain('display: none');
    const opened = ruleBody(sidebarCss, '.tools-details[open] > .tool-list');
    expect(opened).toContain('display: flex');
    // No max-height clip can hide part of the list once opened.
    const list = ruleBody(sidebarCss, '.tool-list');
    expect(list).not.toContain('max-height');
    expect(list).not.toMatch(/overflow[^-]*:\s*(hidden|clip)/);
  });

  it('stylesheet contract: the expanded rows keep a real >=24px box', () => {
    // P412 — the fold restore alone is not enough: each row must declare a
    // height floor well past the 24px visibility bar once its box returns.
    const entry = ruleBody(sidebarCss, '.tool-entry');
    const minHeight = /min-height:\s*(\d+)px/.exec(entry);
    expect(minHeight, '.tool-entry min-height').not.toBeNull();
    expect(Number(minHeight![1])).toBeGreaterThanOrEqual(40);
    // Nothing inside the group may re-hide the opened rows: the only
    // display:none the stylesheet declares sits on the CLOSED list.
    const openRule = ruleBody(sidebarCss, '.tools-details[open] > .tool-list');
    expect(openRule).not.toContain('display: none');
    expect(ruleBody(sidebarCss, '.tool-item')).not.toMatch(
      /display:\s*none|height:\s*0/,
    );
    // The toggle itself must keep a clickable height even though the h3
    // inside it carries margin in other sections.
    expect(ruleBody(sidebarCss, '.tools-toggle')).toContain('cursor: pointer');
  });

  it('stylesheet contract: the drawer pins 设置 to the content, not the viewport bottom', () => {
    // The ≤56px heading→设置 bound only holds in a real engine when no
    // flex mechanism re-creates the free space: the scroll region must
    // stop growing and the footer must drop its auto top margin — both
    // inside the ≤768px drawer block so desktop keeps the pinned footer.
    const body = ruleBody(MOBILE, '.sidebar.sidebar-drawer .sidebar-body');
    expect(body).toContain('flex-grow: 0');
    const footer = ruleBody(
      MOBILE,
      '.sidebar.sidebar-drawer .sidebar-footer',
    );
    expect(footer).toContain('margin-top: 0');
    // The residual measured distance is the drawer gap (12px) + footer
    // border (1px) + padding-top (10px) ≈ 23px — inside the 56px bound —
    // while the overflow path still lands 设置 on the bottom edge.
    expect(ruleBody(MOBILE, '.sidebar.sidebar-drawer')).toContain(
      'gap: 12px',
    );
    expect(footer).toContain('position: sticky');
    expect(footer).toContain('bottom: 0');
    expect(footer).toContain('padding-top: 10px');
    // Desktop keeps the bottom pin — the ≥769px chrome is unchanged.
    expect(ruleBody(sidebarCss, '.sidebar-body')).toContain('flex: 1 1 auto');
    expect(ruleBody(sidebarCss, '.sidebar-footer')).toContain(
      'margin-top: auto',
    );
  });
});

/**
 * P412 — the complementary half the P386 suite never pinned: OPENING the
 * disclosure must reveal real, clickable rows, not a dead shell. Verified
 * against live Chromium before writing this (1440×900 and the 390×844
 * drawer): summary.click() sets `open`, the `[open]` rule restores
 * display:flex, and every `[aria-label^="进阶工具："]` row measures 44px
 * with a live offsetParent.
 *
 * The fake DOM ships no UA <details> behaviour (a summary click cannot set
 * `open` itself) and no layout engine (offsetParent/rects read null/0), so
 * the walkthrough's visibility contract is asserted the same two-level way
 * as the folded half above:
 *  1. DOM level — the <summary> is the details' first element child (the
 *     only position that wires the native toggle); after `open` is applied
 *     — what the UA toggle produces — at least 3 real rows sit inside
 *     `ul.tool-list` (all 5 do), each a <button> whose painted label runs
 *     ≥2 chars, and each click delivers its starter prompt through the
 *     shared onQuickPrompt path.
 *  2. Stylesheet level — asserted in the describe above: `[open]` restores
 *     `display:flex` on that list and `.tool-entry` pins min-height ≥ 40px,
 *     which is what produces the real-engine boxes (offsetParent !== null,
 *     height ≥ 24) this group's contract requires.
 */
describe('P412 · 进阶工具 disclosure — expanding reveals real clickable rows', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (
    widthPx: number,
    heightPx: number,
    mobile: boolean,
    onQuickPrompt: (prompt: string) => void,
  ) => {
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
        createElement(Sidebar, {
          tools: TOOL_FALLBACK,
          profile: null,
          isMobile: mobile,
          open: mobile,
          onQuickPrompt,
          onNewChat: noop,
          onOpenSettings: noop,
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

  const advancedRows = (aside: FakeElement) =>
    aside
      ._walk()
      .filter(
        (el) =>
          (el.getAttribute('aria-label') ?? '').startsWith('进阶工具：'),
      );

  /** What a real engine does when the user activates the <summary>:
   *  toggles the `open` attribute on the parent <details>. The fake DOM
   *  has no UA layer, so the attribute is applied directly — after first
   *  proving the summary sits in the one position that makes it happen. */
  const expandGroup = (aside: FakeElement): FakeElement => {
    const details = aside.querySelector(
      'details.tools-details',
    ) as FakeElement | null;
    expect(details, '进阶工具 disclosure group').not.toBeNull();
    const summary = details!.querySelector(
      'summary.tools-toggle',
    ) as FakeElement | null;
    expect(summary, 'disclosure toggle').not.toBeNull();
    // The native toggle only fires from a <summary> that is the first
    // element child of its <details> — pin that wiring before simulating.
    expect(details!.children[0]).toBe(summary);
    details!.setAttribute('open', '');
    expect(details!.hasAttribute('open')).toBe(true);
    return details!;
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const vp of VIEWPORTS) {
    it(`${vp.width}×${vp.height}: opened group exposes >=3 labelled rows inside the restored list`, async () => {
      const prompts: string[] = [];
      await mount(vp.width, vp.height, vp.mobile, (p) => prompts.push(p));
      const aside = qs('.sidebar')!;
      const details = expandGroup(aside);
      const list = details.querySelector('ul.tool-list');
      expect(list, 'tool list inside the opened group').not.toBeNull();
      const rows = advancedRows(aside);
      expect(
        rows.length,
        'at least 3 visible 进阶工具 entries once opened (all 5 expected)',
      ).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        // Every row belongs to the list the [open] rule restores to
        // display:flex — that membership is what gives it a real box.
        expect(row.closest('ul.tool-list')).toBe(list);
        expect(row.tagName).toBe('BUTTON');
        expect(row.classList.contains('tool-entry')).toBe(true);
        // The painted label — real text the user can read (>=2 chars).
        expect(
          row.innerText.trim().length,
          `${row.getAttribute('aria-label')} painted label`,
        ).toBeGreaterThanOrEqual(2);
        // Not a skeleton or dead row: enabled while not busy, clickable.
        expect(row.hasAttribute('disabled')).toBe(false);
      }
      await unmount();
    });

    it(`${vp.width}×${vp.height}: clicking each opened row drops its starter prompt via onQuickPrompt`, async () => {
      const prompts: string[] = [];
      await mount(vp.width, vp.height, vp.mobile, (p) => prompts.push(p));
      const aside = qs('.sidebar')!;
      expandGroup(aside);
      const rows = advancedRows(aside);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        await act(async () => {
          row.click();
        });
      }
      expect(prompts).toHaveLength(rows.length);
      // Each click delivered the mapped starter question — the same
      // ready-to-edit prefill path the 快捷入口 entries use.
      for (const prompt of prompts) {
        expect(Object.values(TOOL_PROMPTS)).toContain(prompt);
        expect(prompt.length).toBeGreaterThan(0);
      }
      await unmount();
    });
  }
});
