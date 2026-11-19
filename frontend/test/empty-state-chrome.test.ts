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

/**
 * P312 — the pristine first screen (zero stored conversations AND zero
 * messages) used to show the full app chrome with nothing to act on: the
 * header export menu (导出 Markdown / 导出 JSON), 复制 Markdown, the
 * 顾问在线 status, the sidebar「筛选对话」box, plus a duplicate「开始」
 * button inside .welcome competing with the composer.
 *
 * The gate is `isPristine = recentSessions.length === 0 &&
 * messages.length === 0`:
 *
 *  - the three export/copy buttons and .header-status do not render while
 *    pristine — on either breakpoint they fold into 更多操作 (P340 folds
 *    desktop too), and the popover itself mounts nothing but the language
 *    row;
 *  - .recent-chat-filter does not render while the session list is empty;
 *  - the welcome's start button and the passive .welcome-hint copy are
 *    both gone (P394) — leaving exactly ONE [data-primary-cta] element
 *    on the screen, the composer's send key;
 *  - P320: the sidebar「+ 新对话」drops its solid brand fill for a
 *    `secondary` outline while pristine — it was the second pink solid
 *    competing with the composer CTA on the 1440×900 first screen;
 *  - one stored conversation brings every piece back unchanged.
 *
 * Same fake-DOM harness as header-brand-fit.test.ts: mount the real App,
 * stub matchMedia for the ≤768px branch, assert on the rendered tree —
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

function setNarrow(dom: FakeDom, narrow: boolean) {
  const mq = mediaQueryFor(narrow);
  (dom.window as Record<string, unknown>).matchMedia = mq;
  vi.stubGlobal('matchMedia', mq);
}

const STORED_SESSION = {
  activeSessionId: 's-p312',
  sessions: [
    {
      id: 's-p312',
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

describe('P312 · empty-state chrome', () => {
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
    dom = installFakeDom(); // window.innerWidth === 390 — the mobile case
    setNarrow(dom, narrow);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({
            status: 'ok',
            llmConfigured: true,
            llmModel: 'qwen3.8-flash',
          });
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

  /** Shared empty-state contract — identical at both breakpoints except
   *  the welcome hint line, which P374 keeps on desktop only. */
  const expectPristineChrome = async (label: string, narrow: boolean) => {
    const header = qs('.header');
    expect(header, label).not.toBeNull();

    // No export/copy affordance and no status line anywhere in the DOM —
    // on narrow screens they would live inside 更多操作, so open it too.
    expect(header!.textContent).not.toContain('导出');
    expect(header!.textContent).not.toContain('复制 Markdown');
    expect(header!.textContent).not.toContain('在线');
    expect(qsa('.export-btn, .export-json-btn, .copy-export-btn')).toHaveLength(0);
    expect(qs('.header-status')).toBeNull();

    const trigger = qs('.more-menu-trigger');
    if (trigger) {
      await click(trigger);
      const panel = qs('.more-menu-panel');
      expect(panel).not.toBeNull();
      expect(
        panel!.querySelectorAll('.export-btn, .export-json-btn, .copy-export-btn'),
      ).toHaveLength(0);
      expect(panel!.textContent).not.toContain('导出');
      await click(trigger);
    }

    // Empty list → no filter box.
    expect(qs('.recent-chat-filter')).toBeNull();

    // P320: the sidebar「+ 新对话」is demoted to a quiet outlined button —
    // it must not carry the solid brand style that competes with the
    // composer's single primary CTA (P290's .welcome-cta demotion recipe).
    const newChat = qs('.new-chat-btn');
    expect(newChat, label).not.toBeNull();
    expect(newChat!.classList.contains('secondary')).toBe(true);
    expect(newChat!.hasAttribute('data-primary-cta')).toBe(false);

    // One primary action on the whole screen: the composer send key.
    const primaries = qsa('[data-primary-cta]');
    expect(primaries, label).toHaveLength(1);
    expect(primaries[0].classList.contains('input-send')).toBe(true);
    expect(primaries[0].closest('.input-bar')).not.toBeNull();
    expect(qs('#chat-input')).not.toBeNull();

    // .welcome shares one focus-only primary button at every width —
    // P380 mounts P374's hero CTA on desktop too (a data-testid, never
    // the send key's data-primary-cta); P394 retires the hint line at
    // every width (it pointed off-screen on desktop).
    const welcome = qs('.welcome');
    expect(welcome, label).not.toBeNull();
    expect(welcome!.querySelector('[data-primary-cta]')).toBeNull();
    expect(welcome!.querySelector('.welcome-primary-cta')).toBeNull();
    const hero = welcome!.querySelector('[data-testid="hero-primary-cta"]');
    expect(hero, label).not.toBeNull();
    expect(hero!.tagName).toBe('BUTTON');
    // P394: the 「在下方输入框…」 strip is gone at both widths — the
    // hero sits within the composer path now.
    expect(qs('p.welcome-hint')).toBeNull();
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('390×844 empty: no export/copy/status in the header, no sidebar filter, one primary CTA', async () => {
    install(true, false);
    await mountApp();
    await expectPristineChrome('390 empty', true);
    await unmountApp();
  });

  it('1440×900 empty: no export/copy/status in the header, no sidebar filter, one primary CTA', async () => {
    install(false, false);
    await mountApp();
    await expectPristineChrome('1440 empty', false);
    await unmountApp();
  });

  it('1440×900 with one conversation: the full chrome comes back', async () => {
    install(false, true);
    await mountApp();

    const header = qs('.header');
    expect(header).not.toBeNull();

    // P340: on desktop the export trio lives inside 更多操作 — open it.
    await click(qs('.more-menu-trigger'));
    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    for (const [cls, label] of [
      ['export-btn', '导出 Markdown'],
      ['export-json-btn', '导出 JSON'],
      ['copy-export-btn', '复制 Markdown'],
    ] as const) {
      const btn = panel!.querySelector(`.${cls}`);
      expect(btn, cls).not.toBeNull();
      expect(btn!.getAttribute('aria-label')).toBe(label);
    }
    await click(qs('.more-menu-trigger'));

    const status = qs('.header-status');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('顾问在线');

    expect(qs('.recent-chat-filter')).not.toBeNull();

    // P320: with a conversation the sidebar button is the brand solid again.
    const newChat = qs('.new-chat-btn');
    expect(newChat).not.toBeNull();
    expect(newChat!.classList.contains('secondary')).toBe(false);

    // The single primary CTA contract holds with a conversation too —
    // the welcome block itself is gone once messages exist.
    expect(qsa('[data-primary-cta]')).toHaveLength(1);
    expect(qs('.welcome')).toBeNull();

    await unmountApp();
  });

  it('390×844 with one conversation: exports return inside 更多操作, status and filter render', async () => {
    install(true, true);
    await mountApp();

    await click(qs('.more-menu-trigger'));
    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    const labels = panel!
      .querySelectorAll('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['导出 Markdown', '导出 JSON', '复制 Markdown']);
    await click(qs('.more-menu-trigger'));

    // Rendered in the DOM (the ≤768px stylesheet hides the pill visually,
    // the fake DOM has no CSS engine — mounted is the contract here).
    const status = qs('.header-status');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('顾问在线');
    expect(qs('.recent-chat-filter')).not.toBeNull();
    // P320: brand solid returns with the first conversation.
    expect(qs('.new-chat-btn')!.classList.contains('secondary')).toBe(false);
    expect(qsa('[data-primary-cta]')).toHaveLength(1);

    await unmountApp();
  });
});
