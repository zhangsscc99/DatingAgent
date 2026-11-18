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
import {
  isCollapsed,
  saveCollapsed,
  sidebarToggleLabel,
  SIDEBAR_COLLAPSED_KEY,
} from '../src/lib/sidebarCollapse';

/**
 * P281 — at 1440px the fixed 260px sidebar had no collapse control, so the
 * chat column never got its width back. A desktop-only header button
 * (aria-label contains 「侧栏」) now toggles .sidebar-collapsed on the
 * <aside>, the CSS zeroes its width above the 769px breakpoint, and the
 * choice persists under datingAgent.sidebarCollapsed — read in the initial
 * state so there is no expanded-then-collapsed flash. The ≤768px drawer
 * path (打开菜单/关闭菜单) is untouched. Render-level assertions mount the
 * real App against the fake DOM; matchMedia reports desktop (matches:false).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appTsx = read('App.tsx');
const sidebarTsx = read('components/Sidebar.tsx');
const sidebarCss = read('components/Sidebar.css');

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

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    _store: store,
  };
}

describe('P281 · collapsed-preference helpers', () => {
  it('round-trips through the storage key', () => {
    const s = fakeStorage();
    expect(isCollapsed(s)).toBe(false);
    saveCollapsed(true, s);
    expect(s._store.get(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    expect(isCollapsed(s)).toBe(true);
    saveCollapsed(false, s);
    expect(isCollapsed(s)).toBe(false);
  });

  it('falls back to expanded on corrupted or missing values', () => {
    const s = fakeStorage();
    s._store.set(SIDEBAR_COLLAPSED_KEY, 'garbage');
    expect(isCollapsed(s)).toBe(false);
    s._store.set(SIDEBAR_COLLAPSED_KEY, '');
    expect(isCollapsed(s)).toBe(false);
    // 'true' written by an older build still reads as collapsed.
    s._store.set(SIDEBAR_COLLAPSED_KEY, 'true');
    expect(isCollapsed(s)).toBe(true);
  });

  it('switches the toggle label between 收起 and 展开', () => {
    expect(sidebarToggleLabel(false)).toContain('收起');
    expect(sidebarToggleLabel(true)).toContain('展开');
    expect(sidebarToggleLabel(false)).toContain('侧栏');
    expect(sidebarToggleLabel(true)).toContain('侧栏');
  });
});

describe('P281 · desktop toggle wiring (source level)', () => {
  it('a real <button> with a 侧栏 aria-label sits in the header, desktop only', () => {
    const btn = /<button[\s\S]*?sidebar-collapse-btn[\s\S]*?<\/button>/.exec(
      appTsx,
    )?.[0];
    expect(btn).toBeTruthy();
    expect(btn!).toContain('type="button"');
    expect(btn!).toContain('aria-label={sidebarToggleLabel(sidebarCollapsed)}');
    expect(btn!).toContain('aria-controls="app-sidebar"');
    expect(btn!).toContain('onClick={toggleSidebarCollapse}');
    // Rendered under {!isMobile && …} — the narrow drawer keeps 打开菜单.
    const guard = appTsx.lastIndexOf('{!isMobile && (', appTsx.indexOf('sidebar-collapse-btn'));
    expect(guard).toBeGreaterThan(-1);
  });

  it('reads the persisted preference in the initial state — no layout flash', () => {
    expect(appTsx).toContain('useState(() => isCollapsed())');
    expect(appTsx).toContain('collapsed={sidebarCollapsed}');
  });

  it('the aside carries the collapsed class on desktop and goes inert', () => {
    const aside = /<aside[\s\S]*?>/.exec(sidebarTsx)?.[0] ?? '';
    expect(aside).toContain('sidebar-collapsed');
    expect(aside).toContain('collapsed ? true : undefined');
    // Mobile drawer inert/aria wiring is unchanged.
    expect(aside).toContain('aria-hidden={isMobile ? !open : undefined}');
    expect(aside).toContain('isMobile ? (!open ? true : undefined)');
  });

  it('the CSS zeroes the aside width above the mobile breakpoint', () => {
    const desktop = mediaBlock(sidebarCss, '(min-width: 769px)');
    const body = ruleBody(desktop, '.sidebar.sidebar-collapsed');
    expect(body).not.toBe('');
    expect(body).toMatch(/width:\s*0\b/);
    expect(body).toContain('overflow: hidden');
    // The ≤768px drawer rules are untouched by the collapse.
    const narrow = mediaBlock(sidebarCss, '(max-width: 768px)');
    expect(narrow).not.toContain('sidebar-collapsed');
    // Reduced-motion users get no width animation.
    const reduced = mediaBlock(sidebarCss, '(prefers-reduced-motion: reduce)');
    expect(ruleBody(reduced, '.sidebar')).toContain('width 0s');
  });
});

describe('P281 · live toggle (mounted App, desktop)', () => {
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

  const install = () => {
    dom = installFakeDom(); // matchMedia matches nothing → desktop branch
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

  const aside = () => qs('aside') as FakeElement | null;
  const toggle = () =>
    qs('.header')!
      .querySelectorAll('button')
      .find((b) => (b.getAttribute('aria-label') ?? '').includes('侧栏'));

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('clicking the 侧栏 toggle collapses and restores the aside', async () => {
    install();
    await mountApp();

    const btn = toggle() as FakeElement | undefined;
    expect(btn, 'header button whose aria-label contains 侧栏').toBeTruthy();
    expect(btn!.getAttribute('aria-label')).toBe('收起侧栏');
    expect(aside()!.classList.contains('sidebar-collapsed')).toBe(false);
    expect(aside()!.hasAttribute('inert')).toBe(false);

    await click(btn!);
    expect(aside()!.classList.contains('sidebar-collapsed')).toBe(true);
    expect(aside()!.hasAttribute('inert')).toBe(true);
    expect(toggle()!.getAttribute('aria-label')).toBe('展开侧栏');
    expect(dom.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');

    await click(toggle()!);
    expect(aside()!.classList.contains('sidebar-collapsed')).toBe(false);
    expect(aside()!.hasAttribute('inert')).toBe(false);
    expect(toggle()!.getAttribute('aria-label')).toBe('收起侧栏');
    expect(dom.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0');

    await unmountApp();
  });

  it('a stored collapsed preference renders collapsed on first paint', async () => {
    install();
    dom.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    await mountApp();

    expect(aside()!.classList.contains('sidebar-collapsed')).toBe(true);
    expect(toggle()!.getAttribute('aria-label')).toBe('展开侧栏');

    await unmountApp();
  });
});
