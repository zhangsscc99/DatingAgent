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

/**
 * P405 — the 最近对话 column used to carry three different left baselines:
 * the 「今天」 group label sat at `padding: 0 10px` while the filter field
 * and the session rows sat on the section's raw left edge. The fix is pure
 * CSS: `.sidebar` declares `--sidebar-row-pad` and `.recent-chat-group`,
 * `.recent-chat-filter-wrap` and `.recent-chat-row` all inset their
 * content by that one variable, so the label's text edge, the field's box
 * edge and the row card's box edge share a single baseline at every
 * viewport. No JSX, class-name, aria or colour change.
 *
 * The fake DOM ships no layout engine (every rect reads 0 — see
 * sidebar-advanced-group.test.ts), so the rendered assertions cover what
 * they can (elements mount, rects agree trivially, no horizontal
 * overflow) while the stylesheet assertions lock the real contract: all
 * three rules must reference the SAME padding variable instead of
 * hard-coded values.
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

const SESSIONS: StoredChatSession[] = [
  {
    id: 's-today',
    title: '她回了个表情包怎么接',
    updatedAt: Date.now(),
    messages: [
      { id: 'm1', role: 'user', content: '怎么回', createdAt: Date.now() },
    ],
  },
];

const VIEWPORTS: ReadonlyArray<{
  width: number;
  height: number;
  mobile: boolean;
}> = [
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 900, mobile: false },
];

describe('P405 · one left baseline down the 最近对话 column', () => {
  it('.sidebar declares the shared --sidebar-row-pad variable', () => {
    const sidebar = ruleBody(sidebarCss, '.sidebar');
    expect(sidebar).toMatch(/--sidebar-row-pad:\s*\d+px/);
  });

  it('group label, filter wrap and row all pad by the SAME variable', () => {
    for (const sel of [
      '.recent-chat-group',
      '.recent-chat-filter-wrap',
      '.recent-chat-row',
    ]) {
      const body = ruleBody(sidebarCss, sel);
      expect(body, `${sel} rule exists`).not.toBe('');
      expect(
        body,
        `${sel} must reference var(--sidebar-row-pad)`,
      ).toContain('var(--sidebar-row-pad)');
      // No stray hard-coded horizontal padding may fork the baseline again.
      const pad = /padding(?:-(left|right))?:\s*([^;]+)/.exec(body);
      expect(pad, `${sel} padding declaration`).toBeTruthy();
      for (const token of pad![2].trim().split(/\s+/)) {
        expect(
          token === 'var(--sidebar-row-pad)' || token === '0',
          `${sel} horizontal padding token "${token}" is 0 or the shared var`,
        ).toBe(true);
      }
    }
  });

  describe('rendered column', () => {
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
            recentSessions: SESSIONS,
            activeSessionId: null,
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

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    for (const vp of VIEWPORTS) {
      it(`${vp.width}×${vp.height}: group label, filter and row share one left edge, no overflow`, async () => {
        await mount(vp.width, vp.height, vp.mobile);
        const group = qs('.recent-chat-group');
        const filter = qs('.recent-chat-filter');
        const row = qs('.recent-chat-row');
        expect(group, '「今天」group label mounted').not.toBeNull();
        expect(filter, 'filter field mounted').not.toBeNull();
        expect(row, 'session row mounted').not.toBeNull();

        const lefts = [group!, filter!, row!].map(
          (el) => el.getBoundingClientRect().left,
        );
        for (const left of lefts) {
          expect(
            Math.abs(left - lefts[0]),
            'left edges agree within 1px',
          ).toBeLessThanOrEqual(1);
        }

        const sidebar = qs('.sidebar');
        expect(sidebar, 'sidebar mounted').not.toBeNull();
        expect(
          sidebar!.scrollWidth,
          '.sidebar has no horizontal overflow',
        ).toBeLessThanOrEqual(sidebar!.clientWidth);
        await unmount();
      });
    }
  });
});
