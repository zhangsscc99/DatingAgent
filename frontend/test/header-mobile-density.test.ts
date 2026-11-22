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
 * P227 — at 390×844 the header packed seven controls into one row and the
 * three export/copy buttons measured 32×30px. Below the desktop breakpoint
 * they now collapse into a single「更多操作」trigger + popover: the header
 * keeps ≤5 directly-visible buttons, every header button gets a ≥36px hit
 * area, the reply-language select ≥32px.
 * P340 — the collapse now applies at ≥768px too: the 1440×900 topbar had
 * packed six controls at equal weight, so the desktop row keeps only
 * 收起侧栏 / 主题 / 查找 / ⋯ and the same three buttons move into the
 * popover (topbar-density.test.ts owns the ≥1280px ≥12px gap contract).
 * The fake DOM mounts the real App at a 390-wide window with matchMedia
 * reporting the ≤768px query as matching; the desktop branch is verified
 * by remounting with the query not matching.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appCss = read('App.css');
const appTsx = read('App.tsx');
const menuTsx = read('components/HeaderMoreMenu.tsx');

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

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

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

describe('P227 · header density at 390px', () => {
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
    // Drop the rendered tree so the next mount starts clean.
    dom.document.body.textContent = '';
  };

  const headerButtons = () => qs('.header')?.querySelectorAll('button') ?? [];

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
    // One stored conversation so the header shows its fullest form
    // (search toggle visible, export actions enabled).
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-p227',
        sessions: [
          {
            id: 's-p227',
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

  it('renders ≤5 header buttons at the narrow breakpoint, with a「更多操作」trigger', async () => {
    install(true);
    await mountApp();

    // menu-btn + theme + search + more trigger — the fullest narrow header.
    expect(headerButtons()).toHaveLength(4);
    expect(headerButtons().length).toBeLessThanOrEqual(5);

    const trigger = qs('.more-menu-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe('更多操作');
    expect(trigger!.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger!.getAttribute('aria-expanded')).toBe('false');

    // The three export/copy buttons are not in the header until opened.
    expect(qsa('.export-btn, .export-json-btn, .copy-export-btn')).toHaveLength(0);
    expect(qs('.more-menu-panel')).toBeNull();

    await unmountApp();
  });

  it('the popover exposes the three actions under their existing aria-labels', async () => {
    install(true);
    await mountApp();

    await click(qs('.more-menu-trigger'));
    const trigger = qs('.more-menu-trigger');
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');

    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('menu');

    const items = panel!.querySelectorAll('button');
    expect(items).toHaveLength(3);
    const labels = items.map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['导出 Markdown', '导出 JSON', '复制 Markdown']);
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('menuitem');
    }
    // The same click handlers and disabled contract as the header buttons.
    for (const item of items) {
      expect(item.disabled).toBe(false);
    }

    await unmountApp();
  });

  it('Escape closes the popover and returns focus to the trigger', async () => {
    install(true);
    await mountApp();

    const trigger = qs('.more-menu-trigger');
    await click(trigger);
    expect(qs('.more-menu-panel')).not.toBeNull();
    // Opening lands focus on the first menu item.
    expect(dom.document.activeElement).not.toBe(trigger);

    await pressEscape();
    expect(qs('.more-menu-panel')).toBeNull();
    expect(qs('.more-menu-trigger')!.getAttribute('aria-expanded')).toBe('false');
    expect(dom.document.activeElement).toBe(trigger);

    await unmountApp();
  });

  it('closes after an action fires', async () => {
    install(true);
    await mountApp();

    await click(qs('.more-menu-trigger'));
    const mdItem = qs('.more-menu-panel')!.querySelectorAll('button')[0];
    await click(mdItem);
    expect(qs('.more-menu-panel')).toBeNull();

    await unmountApp();
  });

  it('P340: the desktop branch collapses into the same trigger + popover', async () => {
    install(false);
    await mountApp();

    // At ≥768px nothing from the export/copy cluster mounts inline — the
    // topbar keeps 收起侧栏 / 主题 / 查找 / ⋯.
    expect(qsa('.export-btn, .export-json-btn, .copy-export-btn')).toHaveLength(0);
    expect(qs('.lang-select')).toBeNull();
    expect(qs('.more-menu-panel')).toBeNull();

    const trigger = qs('.more-menu-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.closest('.header-actions')).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe('更多操作');

    await click(trigger);
    const panel = qs('.more-menu-panel');
    expect(panel).not.toBeNull();
    const items = panel!.querySelectorAll('button');
    expect(items.map((b) => b.getAttribute('aria-label'))).toEqual([
      '导出 Markdown',
      '导出 JSON',
      '复制 Markdown',
    ]);
    // The labelled text spans and the language row come along unchanged.
    for (const item of items) {
      expect(item.querySelector('.btn-label')).not.toBeNull();
    }
    expect(panel!.querySelector('.lang-select')).not.toBeNull();

    await unmountApp();
  });

  describe('stylesheet guards', () => {
    it('the「更多操作」trigger is a ≥36px header button', () => {
      const base = ruleBody(stripMediaBlocks(appCss), '.more-menu-trigger');
      expect(base).toContain('width: 36px');
      expect(base).toContain('height: 36px');
    });

    it('every ≤768px header button is padded to ≥44px (P441)', () => {
      const narrow = mediaBlock(appCss, '(max-width: 768px)');
      for (const sel of ['.theme-btn', '.more-menu-trigger']) {
        const body = ruleBody(narrow, sel);
        expect(body).toContain('width: 44px');
        expect(body).toContain('height: 44px');
      }
    });

    it('the reply-language select reaches a ≥32px tap height', () => {
      const narrow = mediaBlock(appCss, '(max-width: 768px)');
      const input = ruleBody(narrow, '.lang-select-input');
      expect(input).toMatch(/min-height:\s*3[2-9]px/);
      const wrapper = ruleBody(narrow, '.lang-select');
      expect(wrapper).toMatch(/min-height:\s*3[2-9]px/);
    });

    it('menu items inside the popover keep a ≥36px row and visible labels', () => {
      const base = stripMediaBlocks(appCss);
      // The three item selectors share one grouped rule — allow the
      // selector list to run on to the opening brace.
      const item = base.match(
        /\.more-menu-panel\s+\.export-btn[^{]*\{([^}]*)\}/,
      )?.[1];
      expect(item).toMatch(/min-height:\s*3[6-9]px/);
      const label = ruleBody(base, '.more-menu-panel .btn-label');
      expect(label).toContain('display: inline');
    });

    it('the collapse is unconditional at every width (P340 removed the desktop passthrough)', () => {
      expect(appTsx).toContain("useMediaQuery('(max-width: 768px)')");
      // The menu no longer takes a breakpoint gate: no collapsed prop, no
      // inline-children passthrough left in the component.
      expect(appTsx).not.toContain('collapsed={isMobile}');
      expect(appTsx).not.toContain('collapsed={true}');
      expect(menuTsx).not.toContain('collapsed');
      expect(appTsx).toContain('open={moreOpen}');
      expect(menuTsx).toContain('aria-label="更多操作"');
      expect(menuTsx).toContain('aria-haspopup="menu"');
      expect(menuTsx).toContain('aria-expanded={open}');
    });

    it('the popover carries no emoji glyphs', () => {
      expect(menuTsx).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(menuTsx).toContain('<svg');
      expect(menuTsx).toContain('aria-hidden="true"');
    });
  });
});
