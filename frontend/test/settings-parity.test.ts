/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { CLEAR_ALL_LABEL } from '../src/lib/copy';

/**
 * P353 — measured at 390×844: the settings sheet's 数据 group rendered
 * only 导出 Markdown / 导出 JSON because 清空全部对话 was gated on
 * shouldShowClearAll(hasSessions), and the sidebar's own clear entry
 * lives in the 最近对话 header which also vanishes in the empty state —
 * so on a phone there was no reachable data-management entry at all.
 * The 数据 group now lists the same three entries at every viewport and
 * in every session state:
 *   - zero sessions → 清空全部对话 stays mounted but inert (disabled +
 *     aria-disabled + a why-hint, no click handler) so P270's no-op
 *     confirm still cannot open;
 *   - with sessions → it routes to the same ConfirmDialog
 *     ([role="alertdialog"]) as the sidebar entry.
 *
 * Same fake-DOM harness as empty-state-chrome.test.ts: mount the real
 * App, stub matchMedia for the ≤768px branch, click the real entries —
 * no network, no timing.
 */

/** matchMedia stub whose only matching query is `(max-width: 768px)`. */
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
  activeSessionId: 's-p353',
  sessions: [
    {
      id: 's-p353',
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

describe('P353 · settings 数据 group parity across viewports', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

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

  const install = (narrow: boolean, withSession: boolean) => {
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
        JSON.stringify(STORED_SESSION),
      );
    }
  };

  /** The real path on each breakpoint: on a phone the drawer opens via
   *  打开菜单 first; on desktop the sidebar is already up. */
  const openSettings = async (narrow: boolean) => {
    if (narrow) {
      await click(qs('.menu-btn'));
      await flush();
    }
    await click(qs('.settings-open-btn'));
    await flush();
    expect(qs('section[aria-label="数据"]'), '数据 section').not.toBeNull();
  };

  const dataSection = () => qs('section[aria-label="数据"]') as FakeElement | null;
  const dangerBtn = () =>
    dataSection()?.querySelector('.settings-data-btn.danger') as
      | FakeElement
      | null
      | undefined;

  const dataEntryTexts = () =>
    (dataSection() as FakeElement)
      .querySelectorAll('.settings-data-btn')
      .map((b) => b.textContent);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('390×844 and 1440×900 expose the same 数据 entry set, including 清空全部对话', async () => {
    const collect = async (narrow: boolean) => {
      install(narrow, false);
      await mountApp();
      await openSettings(narrow);
      const texts = dataEntryTexts();
      await unmountApp();
      return texts;
    };
    const mobile = await collect(true);
    const desktop = await collect(false);
    expect([...mobile].sort()).toEqual([...desktop].sort());
    for (const label of ['导出 Markdown', '导出 JSON', CLEAR_ALL_LABEL]) {
      expect(mobile).toContain(label);
    }
  });

  it('with a session, clicking 清空全部对话 opens the shared [role="alertdialog"] confirm', async () => {
    install(true, true);
    await mountApp();
    await openSettings(true);
    const danger = dangerBtn();
    expect(danger).not.toBeNull();
    expect(danger!.getAttribute('aria-label')).toBe(CLEAR_ALL_LABEL);
    await click(danger);
    await flush();
    const dialog = qs('[role="alertdialog"]');
    expect(dialog, 'confirm dialog').not.toBeNull();
    // P416: the in-dialog copy states the counted scope (「清空 1 段对话」),
    // not the fixed entry-point label.
    expect(dialog!.textContent).toMatch(/清空 ?(全部 )?\d+ 段对话/);
    await unmountApp();
  });

  it('at zero sessions the entry stays mounted, disabled, and cannot open the confirm', async () => {
    install(true, false);
    await mountApp();
    await openSettings(true);
    const danger = dangerBtn();
    expect(danger, '清空全部对话 stays visible').not.toBeNull();
    expect(danger!.textContent).toContain(CLEAR_ALL_LABEL);
    expect(
      danger!.getAttribute('disabled') !== null || danger!.disabled === true,
    ).toBe(true);
    expect(danger!.getAttribute('aria-disabled')).toBe('true');
    expect(danger!.getAttribute('aria-label')).toContain('还没有对话可以清空');
    await click(danger);
    await flush();
    expect(qs('[role="alertdialog"]')).toBeNull();
    await unmountApp();
  });

  it('the disabled state also holds on desktop — inert is not a mobile-only quirk', async () => {
    install(false, false);
    await mountApp();
    await openSettings(false);
    const danger = dangerBtn();
    expect(danger).not.toBeNull();
    expect(
      danger!.getAttribute('disabled') !== null || danger!.disabled === true,
    ).toBe(true);
    expect(qsa('[role="alertdialog"]')).toHaveLength(0);
    await unmountApp();
  });
});
