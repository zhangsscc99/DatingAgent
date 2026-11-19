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
  jsonResponse,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import { STARTER_ENTRIES } from '../src/lib/starterEntries';

/**
 * P355 — first-screen/drawer starter parity. Measured at 390×844: the
 * welcome block enumerated three starters (资料优化 · 聊天指导 · 约会规划)
 * while the drawer's「快捷入口」held four buttons — the fourth,
 * 「我们合不合适」, was unreachable from the first screen's mental model
 * and unclassifiable against the three listed categories.
 *
 * The fix is single-source: both surfaces render STARTER_ENTRIES from
 * lib/starterEntries.ts. Asserted here:
 *  1. Source level — ChatWindow.tsx and Sidebar.tsx both consume the one
 *     shared array and hold NO second hardcoded copy of the labels/prompts.
 *  2. 390×844 — the mobile single-line description is generated from the
 *     same array (all four names, same order); the drawer lists the same
 *     four buttons.
 *  3. 1440×900 — the four starter chips are the ONLY copy of the four
 *     names: P388 removed the desktop drawer's identical 快捷入口 section
 *     (two visible entries per name was the measured defect); the
 *     intent-less fourth chip still does real work (prefills the
 *     composer, never a dead option).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const LABELS = STARTER_ENTRIES.map((e) => e.label);

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

describe('P355 · welcome starters and 快捷入口 share one source', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) =>
    [...dom.document.querySelectorAll(sel)] as FakeElement[];

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

  const mountApp = async (widthPx: number) => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(widthPx);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
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
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('both surfaces render the shared constant — no second hardcoded list', () => {
    const chatWindow = read('components/ChatWindow.tsx');
    const sidebar = read('components/Sidebar.tsx');
    const starterIntents = read('lib/starterIntents.ts');
    for (const src of [chatWindow, sidebar]) {
      expect(src).toContain("from '../lib/starterEntries'");
      expect(src).toContain('STARTER_ENTRIES.map(');
    }
    // The intake layer derives its labels from the shared rows too.
    expect(starterIntents).toContain("from './starterEntries'");
    // …and no copy of the entry copy survives in any consumer.
    for (const entry of STARTER_ENTRIES) {
      expect(chatWindow).not.toContain(`'${entry.label}'`);
      expect(chatWindow).not.toContain(`'${entry.prompt}'`);
      expect(sidebar).not.toContain(`'${entry.label}'`);
      expect(sidebar).not.toContain(`'${entry.prompt}'`);
      expect(starterIntents).not.toContain(`'${entry.label}'`);
    }
  });

  it('390×844: the pill hint row names all four entries; the drawer lists the same four', async () => {
    await mountApp(390);
    // P343 contract kept: chips collapse into ONE non-interactive line…
    const line = qs('.starter-chips-line');
    expect(line).not.toBeNull();
    expect(line!.tagName).toBe('P');
    expect(line!.querySelector('button, a[href], [role="button"]')).toBeNull();
    expect(qsa('.starter-chip')).toHaveLength(0);
    // …which P374 renders as a wrap-safe row of independent pills — the
    // shared array in order, all four names, never ·-joined.
    expect(line!.textContent).toContain('也可以直接问：');
    expect(line!.textContent).not.toContain('·');
    const pills = line!.querySelectorAll('.starter-pill');
    expect(pills.map((p) => p.textContent)).toEqual(LABELS);

    // The drawer「快捷入口」— same entries, same count, same order.
    const menuBtn = dom.document
      .querySelectorAll('button')
      .find((b) => b.getAttribute('aria-label') === '打开菜单');
    await click(menuBtn);
    await flush();
    const quick = qsa('.quick-btn');
    expect(quick).toHaveLength(STARTER_ENTRIES.length);
    expect(quick.map((b) => b.getAttribute('aria-label'))).toEqual(
      LABELS.map((l) => `快捷提问：${l}`),
    );
    await unmountApp();
  });

  it('1440×900: the centre chips are the single copy — the 快捷入口 section stays off the desktop aside (P388)', async () => {
    await mountApp(1440);
    const chips = qsa('.starter-chip');
    expect(chips.map((b) => b.getAttribute('aria-label'))).toEqual(LABELS);
    // P388: the persistent aside's identical rows were the second visible
    // entry for every name — the section does not mount at ≥769px at all
    // (real conditional rendering, not hidden DOM). The mobile drawer
    // keeps it, where the hero only renders non-interactive pills.
    expect(qsa('.quick-btn')).toHaveLength(0);
    expect(qs('[aria-label="快捷入口"]')).toBeNull();

    // The fourth chip is not a dead option: no intake branch, so it
    // prefills the composer with its own prompt instead.
    const fourth = chips.find(
      (b) => b.getAttribute('aria-label') === '我们合不合适',
    );
    await click(fourth);
    await flush();
    expect((qs('#chat-input') as FakeElement).value).toBe(
      STARTER_ENTRIES.find((e) => e.label === '我们合不合适')!.prompt,
    );
    expect(qs('.starter-intake')).toBeNull();
    await unmountApp();
  });
});
