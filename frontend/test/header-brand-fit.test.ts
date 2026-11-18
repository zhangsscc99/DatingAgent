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
 * P295 — at 390×844 the header ellipsised the brand into「Datin…」while four
 * controls (自动 / 主题 / 搜索 / 更多) shared the row. Two contracts now hold
 * below the 768px breakpoint:
 *
 *  - the brand never renders a fragment of the name: it degrades to a
 *    logo-only mark whose element carries aria-label="DatingAgent"
 *    (the wordmark h1/subtitle only mount on wider screens);
 *  - the「自动」reply-language select folds into the「更多操作」popover as
 *    its first row — a labelled group, still switchable from the menu —
 *    so the inline row keeps 主题 / 搜索 / 更多 only.
 *
 * P340 folded the select into the popover at desktop widths too; the
 * desktop branch now keeps only the full wordmark inline.
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

describe('P295 · header brand fits and the language picker folds into 更多操作', () => {
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

  const install = (narrow: boolean) => {
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
    // One stored conversation so the fullest narrow header renders
    // (search toggle + enabled export items).
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-p295',
        sessions: [
          {
            id: 's-p295',
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
      }),
    );
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('390px: the brand degrades to a logo-only mark with an accessible name', async () => {
    install(true);
    await mountApp();

    const brand = qs('.header-title');
    expect(brand).not.toBeNull();
    expect(brand!.getAttribute('aria-label')).toBe('DatingAgent');
    expect(brand!.getAttribute('role')).toBe('img');

    // Logo-only: the wordmark never mounts at this width, so no DOM width
    // can ever produce a「Datin…」fragment; the heart mark stays visible.
    expect(qs('.header-title-text')).toBeNull();
    expect(qs('.header')!.querySelector('h1')).toBeNull();
    expect(brand!.querySelector('.logo')!.querySelector('svg')).not.toBeNull();
    expect(brand!.textContent).not.toContain('…');

    await unmountApp();
  });

  it('desktop: the full wordmark stays; the select is inside 更多操作 (P340)', async () => {
    install(false);
    await mountApp();

    const h1 = qs('.header')!.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('DatingAgent');
    expect(qs('.header-title')!.getAttribute('aria-label')).toBe('DatingAgent');
    expect(qs('.header-title')!.hasAttribute('role')).toBe(false);

    // P340: the select lives behind the ⋯ trigger at desktop too — the
    // inline row keeps only 收起侧栏 / 主题 / 查找 / 更多操作.
    expect(qs('.header-actions')!.querySelector('.lang-select-input')).toBeNull();
    const trigger = qs('.more-menu-trigger');
    expect(trigger).not.toBeNull();

    await click(trigger);
    const select = qs('.more-menu-panel')!.querySelector('.lang-select-input');
    expect(select).not.toBeNull();
    expect(select!.closest('.more-menu-panel')).not.toBeNull();

    await unmountApp();
  });

  it('390px: the「自动」select leaves the inline row for the 更多操作 menu', async () => {
    install(true);
    await mountApp();

    // The select is not mounted until the popover opens — the inline row
    // keeps only 主题 / 搜索 / 更多操作.
    expect(qs('.lang-select')).toBeNull();
    expect(qs('.theme-btn')).not.toBeNull();
    expect(qs('.search-toggle-header')).not.toBeNull();
    expect(qs('.more-menu-trigger')).not.toBeNull();

    await click(qs('.more-menu-trigger'));

    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    const picker = panel!.querySelector('.lang-select');
    expect(picker).not.toBeNull();
    // A labelled group row, not a fake menuitem.
    expect(picker!.getAttribute('role')).toBe('group');
    expect(picker!.getAttribute('aria-label')).toBe('回复语言');
    expect(picker!.querySelector('.lang-select-caption')?.textContent).toBe(
      '回复语言',
    );

    const select = picker!.querySelector('select.lang-select-input');
    expect(select).not.toBeNull();
    const options = (select as FakeElement).options;
    expect(
      options.map((o) => [o.getAttribute('value'), o.textContent] as const),
    ).toEqual([
      ['auto', '自动'],
      ['zh', '中文'],
      ['en', 'English'],
    ]);
    // Current selection stays discoverable inside the menu.
    const selected = options
      .filter((o) => o.selected || o.getAttribute('selected') !== null)
      .map((o) => o.getAttribute('value'));
    expect(selected).toEqual(['auto']);

    // The export actions share the same panel, unchanged.
    const itemLabels = panel!
      .querySelectorAll('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(itemLabels).toEqual(['导出 Markdown', '导出 JSON', '复制 Markdown']);

    await unmountApp();
  });

  it('390px: switching the language still works from inside the menu', async () => {
    install(true);
    await mountApp();

    await click(qs('.more-menu-trigger'));
    const select = qs('.more-menu-panel')!.querySelector('.lang-select-input');
    expect(select).not.toBeNull();

    select!.value = 'en';
    await act(async () => {
      select!.dispatchEvent(
        new FakeEvent('change', { bubbles: true, cancelable: true }),
      );
    });

    expect(dom.localStorage.getItem('datingagent.replyLanguage')).toBe('en');
    expect(dom.document.documentElement.lang).toBe('en');

    await unmountApp();
  });
});
