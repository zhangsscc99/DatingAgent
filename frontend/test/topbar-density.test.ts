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
 * P340 — at 1440×900 the topbar packed six controls into one row
 * (收起侧栏 / 深色主题 / 本对话内查找 / 回复语言 select / 导出 Markdown /
 * 导出 JSON), giving the low-frequency export cluster the same visual
 * weight as the high-frequency search/theme actions with only 10px
 * between them. The reply-language picker and the export/copy trio now
 * live inside the existing「更多操作」popover at every width, so the
 * desktop topbar keeps four controls and ≥12px between them.
 *
 * Same fake-DOM harness as header-mobile-density.test.ts: mount the real
 * App with matchMedia reporting desktop (nothing matches), assert on the
 * rendered tree; spacing is locked at stylesheet level (the fake DOM has
 * no CSS engine, so "computed gap" = the declarations a 1440px viewport
 * actually resolves).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appCss = readFileSync(join(SRC, 'App.css'), 'utf8');

/** The stylesheet with every @media block removed — the base rules. */
function stripMediaBlocks(css: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = css.indexOf('@media', cursor);
    if (start < 0) return out + css.slice(cursor);
    out += css.slice(cursor, start);
    const openBrace = css.indexOf('{', start);
    let depth = 0;
    let end = css.length;
    for (let i = openBrace; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    cursor = end;
  }
}

/** `{ query, body }` for each top-level @media block. */
function mediaBlocks(css: string): Array<{ query: string; body: string }> {
  const blocks: Array<{ query: string; body: string }> = [];
  let cursor = 0;
  for (;;) {
    const start = css.indexOf('@media', cursor);
    if (start < 0) return blocks;
    const openBrace = css.indexOf('{', start);
    let depth = 0;
    let end = css.length;
    for (let i = openBrace; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    blocks.push({
      query: css.slice(start + '@media'.length, openBrace).trim(),
      body: css.slice(openBrace + 1, end - 1),
    });
    cursor = end;
  }
}

/** Do the query's width conditions hold at `width` px? Non-width media
 *  features (print, prefers-reduced-motion) do not affect layout gaps on
 *  a screen, so they count as matching. */
function widthConditionsMatch(query: string, width: number): boolean {
  for (const m of query.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
    const n = Number(m[2]);
    if (m[1] === 'min' && width < n) return false;
    if (m[1] === 'max' && width > n) return false;
  }
  return true;
}

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

/** First declared `gap`/`column-gap` px value in a rule body. */
function gapPx(body: string): number | null {
  const m = /(?:column-gap|gap):\s*(\d+)px/.exec(body);
  return m ? Number(m[1]) : null;
}

/** matchMedia stub that matches nothing — the ≥769px desktop branch. */
function desktopMatchMedia() {
  return (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

describe('P340 · desktop topbar density', () => {
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

  const pressEscape = async () => {
    await act(async () => {
      dom.document.dispatchEvent(
        new FakeEvent('keydown', {
          bubbles: true,
          cancelable: true,
          props: { key: 'Escape' },
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
    dom = installFakeDom();
    // 1440×900 desktop: matchMedia matches nothing and the viewport is wide.
    const mq = desktopMatchMedia();
    (dom.window as Record<string, unknown>).matchMedia = mq;
    (dom.window as Record<string, unknown>).innerWidth = 1440;
    (dom.window as Record<string, unknown>).innerHeight = 900;
    vi.stubGlobal('matchMedia', mq);
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
    // One stored conversation so the fullest topbar renders (search
    // toggle visible, export items enabled).
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-p340',
        sessions: [
          {
            id: 's-p340',
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

  it('1440×900: the topbar renders at most four directly clickable controls', async () => {
    install();
    await mountApp();

    const header = qs('.header');
    expect(header).not.toBeNull();

    const controls = [
      ...header!.querySelectorAll('button'),
      ...header!.querySelectorAll('select'),
      ...header!.querySelectorAll('a'),
    ];
    // 收起侧栏 + 深色主题 + 查找 + 更多操作 — exactly four.
    expect(controls.length).toBeLessThanOrEqual(4);
    const labels = controls.map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual([
      '收起侧栏',
      '切换到深色主题',
      '在本对话内查找',
      '更多操作',
    ]);

    // The theme's aria-label flips with state, so assert on the stable
    // class list too — four controls, in this order.
    const buttonClasses = header!
      .querySelectorAll('button')
      .map((b) => b.className);
    expect(buttonClasses).toEqual([
      'sidebar-collapse-btn',
      'theme-btn',
      'search-toggle-header',
      'more-menu-trigger',
    ]);

    await unmountApp();
  });

  it('1440×900: adjacent topbar controls resolve to ≥12px spacing', () => {
    const base = stripMediaBlocks(appCss);

    // The action group (主题 ↔ 查找 ↔ ⋯) is the only place adjacent
    // controls sit side by side; .header-left's gap covers 收起侧栏.
    for (const sel of ['.header-actions', '.header-left']) {
      const gap = gapPx(ruleBody(base, sel));
      expect(gap, `${sel} base gap`).not.toBeNull();
      expect(gap!, `${sel} base gap`).toBeGreaterThanOrEqual(12);
    }

    // No media query that applies at ≥1280px may shrink those gaps below
    // 12px (the ≤768px small-screen block does not match a 1440px
    // viewport and is allowed its own tighter spacing).
    for (const { query, body } of mediaBlocks(appCss)) {
      if (!widthConditionsMatch(query, 1440)) continue;
      for (const sel of ['.header-actions', '.header-left', '.header']) {
        const gap = gapPx(ruleBody(body, sel));
        if (gap !== null) {
          expect(gap, `${sel} gap inside @media ${query}`).toBeGreaterThanOrEqual(
            12,
          );
        }
      }
    }
  });

  it('1440×900: no export/copy/language control is a topbar child while the menu is closed', async () => {
    install();
    await mountApp();

    // Nothing from the low-frequency cluster mounts anywhere in the DOM —
    // the popover renders its children only while open.
    expect(
      qsa('.export-btn, .export-json-btn, .copy-export-btn'),
    ).toHaveLength(0);
    expect(qs('.lang-select')).toBeNull();

    const header = qs('.header')!;
    for (const btn of header.querySelectorAll('button')) {
      const label = btn.getAttribute('aria-label') ?? '';
      expect(label).not.toContain('导出');
      expect(label).not.toContain('复制');
    }
    expect(qs('.header')!.textContent).not.toContain('导出 Markdown');

    await unmountApp();
  });

  it('1440×900: opening 更多操作 reveals all four moved actions with the same handlers', async () => {
    install();
    await mountApp();

    const trigger = qs('[aria-label="更多操作"]');
    expect(trigger).not.toBeNull();
    await click(trigger);
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');

    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('menu');
    expect(dom.document.documentElement.textContent).toContain('导出 Markdown');

    // The three export/copy actions keep their aria-labels, order and
    // enabled state (same buttons, same handlers, gained role=menuitem).
    const items = panel!.querySelectorAll('button');
    expect(items.map((b) => b.getAttribute('aria-label'))).toEqual([
      '导出 Markdown',
      '导出 JSON',
      '复制 Markdown',
    ]);
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('menuitem');
      expect(item.disabled).toBe(false);
    }

    // The reply-language select keeps its current value and options.
    const picker = panel!.querySelector('.lang-select');
    expect(picker).not.toBeNull();
    const select = picker!.querySelector('select.lang-select-input')!;
    const options = select.options.map(
      (o) => [o.getAttribute('value'), o.textContent] as const,
    );
    expect(options).toEqual([
      ['auto', '自动'],
      ['zh', '中文'],
      ['en', 'English'],
    ]);

    // Opening lands focus on the first menu item.
    expect(dom.document.activeElement).not.toBe(trigger);

    await unmountApp();
  });

  it('1440×900: the language select still calls the same setter from inside the menu', async () => {
    install();
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

  it('1440×900: Escape closes the menu and focus returns to the trigger', async () => {
    install();
    await mountApp();

    const trigger = qs('.more-menu-trigger');
    await click(trigger);
    expect(qs('.more-menu-panel')).not.toBeNull();

    await pressEscape();
    expect(qs('.more-menu-panel')).toBeNull();
    expect(qs('.more-menu-trigger')!.getAttribute('aria-expanded')).toBe('false');
    expect(dom.document.activeElement).toBe(trigger);

    await unmountApp();
  });

  it('1440×900: an action firing closes the menu', async () => {
    install();
    await mountApp();

    await click(qs('.more-menu-trigger'));
    const mdItem = qs('.more-menu-panel')!.querySelectorAll('button')[0];
    await click(mdItem);
    expect(qs('.more-menu-panel')).toBeNull();

    await unmountApp();
  });
});
