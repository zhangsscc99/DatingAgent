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
 *  1. Source level — Sidebar.tsx consumes the one shared array and NO
 *     consumer holds a second hardcoded copy of the labels/prompts.
 *     P413 removed ChatWindow's last render of the array (the compact
 *     pill row — a lookalike duplicate of the example cards), so the
 *     sidebar is now the single renderer.
 *  2. 390×844 — the hero's non-interactive pill row is gone (P413); the
 *     drawer's「快捷入口」is the phone's single starter path and still
 *     lists all four buttons in the shared order.
 *  3. 1440×900 — the aside's 快捷入口 rows are the ONLY copy of the four
 *     names: P394 removed the hero's identical starter capsules (two
 *     visible entries per name was the measured defect); an intent-less
 *     row still does real work (prefills the composer, never a dead
 *     option) and an intent row opens the hero's intake panel.
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

  it('the sidebar renders the shared constant — no second hardcoded list anywhere', () => {
    const chatWindow = read('components/ChatWindow.tsx');
    const sidebar = read('components/Sidebar.tsx');
    const starterIntents = read('lib/starterIntents.ts');
    // P413: ChatWindow no longer renders the array at all — the compact
    // pill row was the hero's last starter copy and it duplicated the
    // example cards. The sidebar keeps the single render.
    expect(chatWindow).not.toContain("from '../lib/starterEntries'");
    expect(chatWindow).not.toContain('STARTER_ENTRIES.map(');
    expect(sidebar).toContain("from '../lib/starterEntries'");
    expect(sidebar).toContain('STARTER_ENTRIES.map(');
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

  it('390×844: the pill row is gone (P413); the drawer is the phone starter path', async () => {
    await mountApp(390);
    // P413: the non-interactive pill row duplicated the example cards on
    // the same screen, so it no longer mounts — the phone's only starter
    // entries are the drawer's 快捷入口 rows.
    expect(qs('.starter-chips-line')).toBeNull();
    expect(qsa('.starter-pill')).toHaveLength(0);
    expect(qsa('.starter-chip')).toHaveLength(0);

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

  it('1440×900: the aside rows are the single copy — the hero capsules are gone (P394)', async () => {
    await mountApp(1440);
    // P394: the hero's .starter-chip capsules were the second visible
    // entry for every name — they do not mount at ≥769px at all (real
    // conditional rendering, not hidden DOM). The aside keeps the
    // section, where its rows stay the working starter path.
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qs('.starter-chips')).toBeNull();
    expect(qs('[aria-label="快捷入口"]')).not.toBeNull();
    const quick = qsa('.quick-btn');
    expect(quick.map((b) => b.getAttribute('aria-label'))).toEqual(
      LABELS.map((l) => `快捷提问：${l}`),
    );

    // The intent-less fourth entry is not a dead option: no intake
    // branch, so it prefills the composer with its own prompt instead.
    const fourth = quick.find(
      (b) => b.getAttribute('aria-label') === '快捷提问：我们合不合适',
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
