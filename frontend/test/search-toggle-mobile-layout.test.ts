/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
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
  FIND_IN_CONVERSATION_LABEL,
  FIND_IN_CONVERSATION_PLACEHOLDER,
} from '../src/lib/searchLabels';

/**
 * P226 — at 390×844 the floating `.search-toggle` (position:absolute inside
 * `.messages-wrap`, rect x330/y77/36×36) overlapped the first user bubble
 * (x58/y81/310×103) and covered its last characters; P206 had only moved
 * the trigger into the header at ≥1024px. Now the header trigger
 * (`.search-toggle-header`) serves every breakpoint — nothing floats over
 * `.messages-wrap` — while ≥1024px keeps the compact 32×32 button it
 * shipped with. The fake DOM mounts the real App at a 390-wide window and
 * exercises the click → focus path for real; CSS guards are source-level.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appCss = read('App.css');
const chatTsx = read('components/ChatWindow.tsx');
/** Comments stripped — the explanatory comment still names .search-toggle. */
const chatCss = read('components/ChatWindow.css').replace(/\/\*[\s\S]*?\*\//g, '');
const searchBarTsx = read('components/ChatSearchBar.tsx');

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

describe('P226 · search toggle at narrow (390px) layout', () => {
  let dom: FakeDom;

  const qs = (sel: string) => dom.document.querySelector(sel) as FakeElement | null;

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

  beforeAll(() => {
    dom = installFakeDom(); // window.innerWidth === 390 — the mobile case
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true, llmModel: 'qwen3.8-flash' });
        }
        return jsonResponse({});
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-p226',
        sessions: [
          {
            id: 's-p226',
            title: '周末邀约',
            updatedAt: 1000,
            messages: [
              { id: 'm1', role: 'user', content: '她今天答应周末出来了，第一句要说什么？', createdAt: 1 },
              { id: 'm2', role: 'assistant', content: '恭喜你！可以先轻松回应她的兴趣点。', createdAt: 2 },
            ],
          },
        ],
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('no .search-toggle element exists inside (or outside) .messages-wrap at mobile width', async () => {
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
    await flush(); // let the session-restore fetch settle so the header renders

    // The conversation is on screen…
    expect(qs('.messages-wrap')).not.toBeNull();
    expect(qs('.bubble')).not.toBeNull();
    // …and nothing classed .search-toggle floats over it — the element is
    // gone entirely, so it cannot be a child of .messages-wrap.
    expect(dom.document.querySelectorAll('.search-toggle')).toHaveLength(0);
    expect(chatTsx).not.toContain('className="search-toggle"');
    expect(chatCss).not.toMatch(/\.search-toggle[\s,{:]/);

    // The trigger is a header icon button with the same accessible name.
    const toggle = qs('.search-toggle-header');
    expect(toggle).not.toBeNull();
    expect(toggle!.closest('.header-actions')).not.toBeNull();
    expect(toggle!.closest('.messages-wrap')).toBeNull();
    expect(toggle!.getAttribute('aria-label')).toBe(FIND_IN_CONVERSATION_LABEL);
    expect(toggle!.getAttribute('title')).toBe(FIND_IN_CONVERSATION_LABEL);
    // Inline SVG icon — no emoji glyph (P208 contract).
    expect(toggle!.querySelector('svg')).not.toBeNull();

    // Clicking it opens the filter bar and focuses its input — the same
    // open/focus behaviour the floating button had.
    await click(toggle);
    await flush();
    const input = qs('.chat-search-input');
    expect(input).not.toBeNull();
    expect(input!.getAttribute('placeholder')).toBe(
      FIND_IN_CONVERSATION_PLACEHOLDER,
    );
    expect(dom.document.activeElement).toBe(input);

    // The bubble list is still fully rendered behind the open bar.
    expect(qs('.bubble')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  describe('stylesheet guards', () => {
    it('the header toggle is a ≥36×36 mobile button, not display:none', () => {
      const base = ruleBody(stripMediaBlocks(appCss), '.search-toggle-header');
      expect(base).toMatch(/display:\s*inline-flex/);
      expect(base).not.toMatch(/display:\s*none/);
      expect(base).toContain('width: 36px');
      expect(base).toContain('height: 36px');
    });

    it('stays reachable in the header at desktop width (≥1024px only resizes to 32px)', () => {
      const desktop = mediaBlock(appCss, '(min-width: 1024px)');
      expect(desktop).not.toBe('');
      const rule = ruleBody(desktop, '.search-toggle-header');
      expect(rule).not.toMatch(/display:\s*none/);
      expect(rule).toContain('width: 32px');
      expect(rule).toContain('height: 32px');
    });

    it('keeps the narrow header within the viewport — status chip hidden at ≤768px', () => {
      const narrow = mediaBlock(appCss, '(max-width: 768px)');
      expect(narrow).toMatch(/\.header-status\s*\{[^}]*display:\s*none/);
    });

    it('the open-search path still lands focus in the filter input', () => {
      // App → ChatWindow handle → openSearch → ChatSearchBar autofocus.
      expect(chatTsx).toContain('setSearchOpen(true)');
      expect(chatTsx).toMatch(/\{searchOpen && \(\s*<ChatSearchBar/);
      expect(searchBarTsx).toContain('inputRef.current?.focus()');
    });
  });
});
