/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
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
import Sidebar from '../src/components/Sidebar';
import { TOOL_PROMPTS, toolPromptFor } from '../src/lib/toolPrompts';

/**
 * P316 — the five 进阶工具 rows (改资料/接话术/排约会/看匹配/关系建议) were
 * bare <li> text: no role, no handler, dead on click (P287, sixth repro).
 * Each row is now a real <button> that runs the same onQuickPrompt path as
 * the 快捷入口 entries — which App routes to the composer's prefill handle,
 * so a click drops a ready-to-edit draft into #chat-input and the user
 * still presses send. Guards pin the rendered shape (button + aria-label),
 * the click-through-prefill behaviour (non-empty textarea, no dispatched
 * message), the cursor rule, and the no-dead-li / no-internal-code-title
 * contracts. Rendered assertions mount the real App on the fake DOM, same
 * style as sidebar-collapse.test.ts (P281).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebarTsx = read('components/Sidebar.tsx');
const appTsx = read('App.tsx');
const sidebarCss = read('components/Sidebar.css');

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

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

const noop = () => {};
const ALL_CAPS_ENGLISH = /\b[A-Z]{2,}\b/;
const EXPECTED_LABELS = ['改资料', '接话术', '排约会', '看匹配', '关系建议'];

function renderSidebar() {
  return renderToStaticMarkup(
    createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
  );
}

describe('P316 · every 进阶工具 row is a real button', () => {
  it('renders one <button type="button"> per visible row, each with an aria-label', () => {
    const html = renderSidebar();
    const section = /<section[^>]*aria-label="进阶工具"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0];
    expect(section).toBeTruthy();
    const buttons = [
      ...section!.matchAll(/<button([^>]*)>([^<]+)<\/button>/g),
    ];
    expect(buttons.length).toBe(EXPECTED_LABELS.length);
    expect(buttons.map((b) => b[2])).toEqual(EXPECTED_LABELS);
    for (const [attrs] of buttons) {
      expect(attrs).toContain('type="button"');
      expect(attrs).toContain('class="tool-entry"');
      expect(attrs).toContain('aria-label="进阶工具：');
    }
    // The row shell stays <li class="tool-item"> — a slot, not a dead row.
    expect(section).toContain('class="tool-item"');
  });

  it('no leftover li renders without a handler-bearing button inside', () => {
    const html = renderSidebar();
    const section = /<section[^>]*aria-label="进阶工具"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0];
    const lis = [...section!.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map(
      (m) => m[0],
    );
    expect(lis.length).toBeGreaterThan(0);
    for (const li of lis) {
      expect(li).toContain('<button');
      expect(li).toContain('aria-label=');
    }
  });

  it('the section heading carries no internal code (all-caps English)', () => {
    const html = renderSidebar();
    const section = /<section[^>]*aria-label="进阶工具"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0];
    const heading = /<h3>([^<]*)<\/h3>/.exec(section!)?.[1] ?? '';
    expect(heading).toBe('进阶工具');
    expect(ALL_CAPS_ENGLISH.test(heading)).toBe(false);
  });

  it('every row calls the shared onQuickPrompt prefill path', () => {
    const listStart = sidebarTsx.indexOf('className="tool-list"');
    const block = sidebarTsx.slice(listStart, sidebarTsx.indexOf('</ul>', listStart));
    expect(block).toContain('tools.length ? tools : TOOL_FALLBACK');
    expect(block).toContain('onClick={() => onQuickPrompt(prompt)}');
    // One pathway — no second prompt callback was invented.
    expect(block).not.toContain('onToolPrompt');
    expect(block).not.toContain('onClick={() => sendMessage');
  });

  it('the tool-entry rule is a pointer cursor, never auto', () => {
    const body = ruleBody(sidebarCss, '.tool-entry');
    expect(body).not.toBe('');
    expect(body).toContain('cursor: pointer');
    expect(body).not.toMatch(/cursor:\s*auto/);
    // ≥44px touch target inside the mobile media block.
    const mobile = mediaBlock(sidebarCss, '(max-width: 768px)');
    expect(ruleBody(mobile, '.tool-entry')).toContain('min-height: 44px');
    // Hover/focus feedback so the row reads as clickable.
    const hover = ruleBody(sidebarCss, '.tool-entry:hover:not(:disabled)');
    expect(hover).toContain('background');
    expect(ruleBody(sidebarCss, '.tool-entry:focus-visible')).toContain(
      'outline',
    );
  });

  it('App routes onQuickPrompt to the composer prefill, never sendMessage', () => {
    const handler = appTsx
      .split('\n')
      .find((line) => line.includes('handleQuickPrompt ='));
    expect(handler).toBeTruthy();
    const block = appTsx.slice(
      appTsx.indexOf('handleQuickPrompt'),
      appTsx.indexOf('handleQuickPrompt') + 400,
    );
    expect(block).toContain('prefillComposer');
    expect(block).not.toContain('sendMessage(prompt)');
    // ChatWindow exposes the prefill handle the sidebar path rides on.
    const chatWindowTsx = read('components/ChatWindow.tsx');
    expect(chatWindowTsx).toContain('prefillComposer: (text: string) => void');
    expect(chatWindowTsx).toContain('inputRef.current?.prefill(text)');
  });
});

describe('P316 · prompt map covers every tool id', () => {
  it('all five shipped tool ids have a non-empty starter prompt', () => {
    for (const name of [
      'analyze_profile',
      'coach_conversation',
      'plan_date',
      'check_compatibility',
      'get_relationship_advice',
    ]) {
      const prompt = toolPromptFor(name);
      expect(prompt, name).toBeTruthy();
      expect(prompt!.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TOOL_PROMPTS)).toHaveLength(5);
  });

  it('an unmapped tool id yields no prompt — the row is skipped, not dead', () => {
    expect(toolPromptFor('mystery_backend_tool')).toBeNull();
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        tools: [{ name: 'mystery_backend_tool', label: '神秘工具', icon: '' }],
        onQuickPrompt: noop,
        onNewChat: noop,
      }),
    );
    const section = /<section[^>]*aria-label="进阶工具"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0];
    expect(section).toBeTruthy();
    expect(section).not.toContain('神秘工具');
    expect(section).not.toContain('class="tool-item"');
  });
});

describe('P316 · click prefills the composer without sending (mounted App)', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  const fetches: string[] = [];

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
    dom = installFakeDom(); // matchMedia matches nothing → desktop sidebar
    fetches.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string'
            ? input
            : String((input as { url?: string })?.url);
        fetches.push(url);
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

  const section = () => qs('section[aria-label="进阶工具"]');
  const textarea = () => qs('textarea') as FakeElement | null;

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('clicking each entry fills the textarea and dispatches no message', async () => {
    install();
    await mountApp();

    const sec = section() as FakeElement | null;
    expect(sec, '进阶工具 section').toBeTruthy();
    const buttons = sec!
      .querySelectorAll('button')
      .filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('进阶工具：'));
    expect(buttons.length).toBe(EXPECTED_LABELS.length);

    // Every row sits inside an <li> — no bare dead <li> remains.
    for (const btn of buttons) {
      expect(btn.parentElement?.tagName).toBe('LI');
    }

    const area = textarea() as FakeElement | null;
    expect(area, 'composer textarea').toBeTruthy();
    expect(area!.value).toBe('');

    const prompts = Object.values(TOOL_PROMPTS);
    for (const btn of buttons) {
      await click(btn);
      // Prefill replaces the draft wholesale — each click leaves a known,
      // non-empty starter question in the composer.
      expect(
        prompts.includes(area!.value),
        `prefill for ${btn.getAttribute('aria-label')}`,
      ).toBe(true);
      // No message was dispatched: /api/chat (/stream) was never fetched
      // and the prefilled text never landed in the message log.
      expect(fetches.filter((u) => u.includes('/api/chat'))).toHaveLength(0);
      const messages = dom.document.querySelector('.messages');
      expect(messages?.textContent ?? '').not.toContain(area!.value);
    }

    await unmountApp();
  });
});
