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

/**
 * P324 — at 390×844 the open drawer measured ~300px (min(300px, 85vw)),
 * leaving a ~90px strip of live main content — the「在本对话内查找」glass,
 * the「⋯」menu and the send key — visible and tappable beside it, with no
 * convincing scrim on top.
 *
 * The sheet is now min(340px, 92vw) below 768px and a full-bleed 100vw
 * below 430px (shadow off — nothing beside it to shadow), the backdrop
 * keeps its var(--overlay) scrim and gains a blur(2px) filter, the
 * drawer's scroll region carries overscroll-behavior: contain, and Tab is
 * trapped inside #app-sidebar while the drawer is open (focus returns to
 * 打开菜单 on close).
 *
 * Layout note: this fake-DOM harness has no layout engine, so
 * document.elementFromPoint(380, 20) cannot be exercised — it has no
 * answer here regardless of styling. The geometry half of the verify
 * bullet is asserted structurally instead: the ≤768px width declaration
 * is parsed and required ≥90vw (92vw at a 390px viewport puts x=380
 * inside the sheet), the ≤430px full-bleed rule is asserted, and the
 * mounted tree is checked for the scrim element plus the .open drawer.
 * Source-level assertions + a real App mount, in the style of
 * empty-state-chrome.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

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

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

const sidebarCss = read('components/Sidebar.css');
const appCss = read('App.css');
const appTsx = read('App.tsx');
const mobile = mediaBlock(sidebarCss, '(max-width: 768px)');
const phone = mediaBlock(sidebarCss, '(max-width: 430px)');

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

describe('P324 · drawer covers the phone viewport', () => {
  it('declares a ≥90vw sheet below 768px and a full-bleed sheet below 430px', () => {
    const drawer = ruleBody(mobile, '.sidebar.sidebar-drawer');
    const widthDecl = /width:\s*min\(\s*(\d+)px\s*,\s*(\d+)vw\s*\)/.exec(drawer);
    // No layout engine in this harness — elementFromPoint(380, 20) is not
    // computable, so the verify bullet's hit-test is covered by geometry:
    // at 390px BOTH queries match and the ≤430px rule wins the cascade
    // (equal specificity, later block) — the sheet resolves to 100vw =
    // 390px, so x=380 lies inside the drawer rather than on the topbar.
    expect(widthDecl, 'drawer width min(<px>, <vw>)').not.toBeNull();
    expect(Number(widthDecl![2])).toBeGreaterThanOrEqual(90);
    expect(phone).not.toBe('');
    const fullBleed = ruleBody(phone, '.sidebar.sidebar-drawer');
    expect(fullBleed).toContain('width: 100vw');
    expect(fullBleed).toContain('box-shadow: none');
  });

  it('keeps the backdrop under the drawer and themed by --overlay', () => {
    // The scrim still mounts exactly while the mobile drawer is open.
    expect(appTsx).toContain('isMobile && sidebarOpen');
    expect(appTsx).toContain('className="sidebar-backdrop"');
    const backdrop = ruleBody(appCss, '.sidebar-backdrop');
    expect(backdrop).toContain('background: var(--overlay)');
    expect(backdrop).toContain('backdrop-filter');
    const backdropZ = Number(/z-index:\s*(\d+)/.exec(backdrop)?.[1]);
    const drawerZ = Number(
      /z-index:\s*(\d+)/.exec(ruleBody(mobile, '.sidebar.sidebar-drawer'))?.[1],
    );
    expect(backdropZ).toBeGreaterThan(0);
    expect(backdropZ).toBeLessThan(drawerZ);
  });

  it('drops the backdrop fade-in under prefers-reduced-motion', () => {
    const reduced = ruleBody(
      mediaBlock(appCss, '(prefers-reduced-motion: reduce)'),
      '.sidebar-backdrop',
    );
    expect(reduced).toContain('animation: none');
  });

  it('contains overscroll inside the drawer scroll region', () => {
    const body = ruleBody(mobile, '.sidebar.sidebar-drawer .sidebar-body');
    expect(body).toContain('overscroll-behavior: contain');
  });
});

describe('P324 · mounted drawer at 390×844', () => {
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

  const keydown = async (el: FakeElement | FakeDom['document'], key: string, shiftKey = false) => {
    await act(async () => {
      el.dispatchEvent(
        new FakeEvent('keydown', {
          bubbles: true,
          cancelable: true,
          props: { key, shiftKey },
        }),
      );
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

  const install = () => {
    dom = installFakeDom(); // window.innerWidth === 390 — the mobile case
    setNarrow(dom, true);
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
    // One stored conversation so the drawer mounts its fullest form —
    // filter input, recent-chat rows and the tools list all focusable.
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-p324',
        sessions: [
          {
            id: 's-p324',
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

  const openDrawer = async () => {
    await click(qs('.menu-btn'));
    await flush();
  };

  /** The drawer's tabbable set — same selector + filters App.tsx applies. */
  const drawerFocusables = () =>
    (qs('#app-sidebar') as FakeElement)
      .querySelectorAll('a[href], button, input, select, textarea, [tabindex]')
      .filter(
        (el) =>
          !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1',
      );

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('mounts the scrim and the open sheet, with focus inside the drawer', async () => {
    install();
    await mountApp();

    expect(qs('.sidebar-backdrop')).toBeNull();
    await openDrawer();

    const backdrop = qs('.sidebar-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.getAttribute('aria-label')).toBe('关闭菜单');
    const drawer = qs('#app-sidebar');
    expect(drawer).not.toBeNull();
    expect(drawer!.classList.contains('sidebar-drawer')).toBe(true);
    expect(drawer!.classList.contains('open')).toBe(true);
    // Focus moved inside the sheet on open (Sidebar focuses its × button,
    // which is the drawer's first tabbable element).
    expect(drawer!.contains(dom.document.activeElement)).toBe(true);
    expect(dom.document.activeElement!.classList.contains('sidebar-close-btn')).toBe(true);

    await unmountApp();
  });

  it('traps Tab inside the drawer and wraps at both ends', async () => {
    install();
    await mountApp();
    await openDrawer();
    const drawer = qs('#app-sidebar')!;

    const focusable = drawerFocusables();
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Tab at the last tabbable element wraps to the first.
    last.focus();
    await keydown(last, 'Tab');
    expect(dom.document.activeElement).toBe(first);

    // Shift+Tab at the first wraps to the last.
    first.focus();
    await keydown(first, 'Tab', true);
    expect(dom.document.activeElement).toBe(last);

    // Tab while focus sits outside the drawer (the scrim) is pulled back in.
    const backdrop = qs('.sidebar-backdrop')!;
    backdrop.focus();
    await keydown(backdrop, 'Tab');
    expect(dom.document.activeElement).toBe(first);
    expect(drawer.contains(dom.document.activeElement)).toBe(true);

    await unmountApp();
  });

  it('returns focus to the 打开菜单 trigger when the drawer closes', async () => {
    install();
    await mountApp();
    await openDrawer();
    expect(qs('#app-sidebar')!.classList.contains('open')).toBe(true);

    // Escape closes the drawer — the same path the scrim click and the ×
    // button take (all funnel into setSidebarOpen(false)).
    await keydown(dom.document, 'Escape');
    await flush();

    expect(qs('#app-sidebar')!.classList.contains('open')).toBe(false);
    expect(qs('.sidebar-backdrop')).toBeNull();
    const menuBtn = qs('.menu-btn');
    expect(menuBtn).not.toBeNull();
    expect(dom.document.activeElement).toBe(menuBtn);

    await unmountApp();
  });
});
