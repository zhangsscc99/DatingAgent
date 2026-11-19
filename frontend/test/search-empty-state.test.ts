/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { FILTER_SESSIONS_HINT } from '../src/lib/searchLabels';
import type { StoredChatSession } from '../src/lib/chatStorage';
import {
  FakeEvent,
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';

/**
 * P347 — the filter empty state used to pack the dashed scope note and the
 * 清除筛选 action onto one line, so the action read as inline text instead
 * of a button. The empty state is now three rows — main copy / scope note
 * / a standalone 清除筛选 button — with no 「——」 prefix, a ≥88px min-width
 * button, and ≥8px of vertical space above it.
 *
 * No DOM renderer ships with this repo — the fake DOM reports zero
 * getBoundingClientRect()s — so the size/gap contracts are asserted on the
 * resolved CSS rules in Sidebar.css, in the style of
 * composer-layout.test.ts, while the DOM mount pins the structure and copy.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebarCss = read('components/Sidebar.css');
const sidebarTsx = read('components/Sidebar.tsx');

const session = (id: string, title: string): StoredChatSession => ({
  id,
  title,
  updatedAt: 1,
  messages: [],
});

/** Slice the declarations of `.selector { … }` with brace matching. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
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

/** First numeric px value of `prop: Npx` inside a rule body, or NaN. */
function pxValue(body: string, prop: string): number {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?[\\d.]+)px`));
  return m ? Number(m[1]) : NaN;
}

describe('P347 · search empty state three rows + real 清除筛选 button', () => {
  describe('DOM: a zero-match query renders hint / note / button rows', () => {
    let dom: FakeDom;
    let root: Root;

    const qs = (sel: string) =>
      dom.document.querySelector(sel) as FakeElement | null;

    const mountWithMiss = async () => {
      dom = installFakeDom();
      const [{ createRoot }, { default: Sidebar }] = await Promise.all([
        import('react-dom/client'),
        import('../src/components/Sidebar'),
      ]);
      const container = dom.document.createElement('div');
      dom.document.body.appendChild(container);
      root = createRoot(container as unknown as HTMLElement);
      await act(async () => {
        root.render(
          createElement(Sidebar, {
            tools: [],
            recentSessions: [
              session('s1', '周末约会计划'),
              session('s2', '资料优化建议'),
            ],
            onQuickPrompt: () => {},
            onNewChat: () => {},
          }),
        );
      });
      const input = qs('.recent-chat-filter') as FakeElement;
      expect(input).toBeTruthy();
      input.value = 'zzzzz不存在';
      await act(async () => {
        input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
      });
    };

    it('renders an independent button labelled 清除筛选', async () => {
      await mountWithMiss();
      const hint = qs('.filter-empty-hint');
      expect(hint, 'zero-match hint row').toBeTruthy();
      const button = qs('button.filter-empty-clear');
      expect(button, 'standalone 清除筛选 button').toBeTruthy();
      expect(button!.tagName).toBe('BUTTON');
      expect(button!.textContent!.trim()).toBe('清除筛选');
      expect(button!.getAttribute('aria-label')).toBe('清除筛选');
      await act(async () => {
        root.unmount();
      });
    });

    it('orders the rows 主文案 → 说明 → 按钮 as siblings, not inline text', async () => {
      await mountWithMiss();
      const hint = qs('.filter-empty-hint')!;
      const kids = hint.children.map((c) => c.className);
      expect(kids[0]).toContain('filter-empty-hint-text');
      expect(kids[1]).toContain('filter-empty-hint-scope');
      expect(kids[2]).toContain('filter-empty-clear');
      // The button sits on its own row — not concatenated into the note.
      const scope = qs('.filter-empty-hint-scope')!;
      expect(scope.textContent).not.toContain('清除筛选');
      await act(async () => {
        root.unmount();
      });
    });

    it('the scope note carries no 「——」 dash prefix', async () => {
      await mountWithMiss();
      const scope = qs('.filter-empty-hint-scope')!;
      expect(scope.textContent).not.toContain('——');
      expect(scope.textContent).toContain(FILTER_SESSIONS_HINT);
      await act(async () => {
        root.unmount();
      });
    });

    it('clicking the button clears the filter and restores the list', async () => {
      await mountWithMiss();
      const button = qs('button.filter-empty-clear')!;
      await act(async () => {
        button.dispatchEvent(
          new FakeEvent('click', { bubbles: true, cancelable: true }),
        );
      });
      expect(qs('.filter-empty-hint')).toBeNull();
      expect(
        dom.document.querySelectorAll('.recent-chat-item'),
      ).toHaveLength(2);
      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('CSS contracts (fake DOM reports zero rects)', () => {
    const buttonRule = ruleBody(sidebarCss, '.filter-empty-clear');
    const hintRule = ruleBody(sidebarCss, '.filter-empty-hint');
    const scopeRule = ruleBody(sidebarCss, '.filter-empty-hint-scope');

    it('the button is styled like a button: min-width ≥88px, padding, border, radius', () => {
      expect(pxValue(buttonRule, 'min-width')).toBeGreaterThanOrEqual(88);
      expect(buttonRule).toMatch(/padding\s*:/);
      expect(buttonRule).toMatch(/border\s*:/);
      expect(buttonRule).toMatch(/border-radius\s*:/);
      expect(buttonRule).toMatch(/cursor\s*:\s*pointer/);
    });

    it('the note-to-button vertical gap is ≥8px (margin and/or row gap)', () => {
      const margin = pxValue(buttonRule, 'margin-top');
      const rowGap = pxValue(hintRule, 'gap');
      const effective = Math.max(
        Number.isNaN(margin) ? 0 : margin,
        Number.isNaN(rowGap) ? 0 : rowGap,
      );
      expect(effective).toBeGreaterThanOrEqual(8);
    });

    it('the hint is a column stack so each row takes its own line', () => {
      expect(hintRule).toMatch(/flex-direction\s*:\s*column/);
      expect(scopeRule).not.toMatch(/display\s*:\s*inline/);
    });
  });

  describe('source guards', () => {
    it('the scope note is rendered without the literal 「——」 prefix', () => {
      expect(sidebarTsx).toContain('{FILTER_SESSIONS_HINT}');
      expect(sidebarTsx).not.toContain('——{FILTER_SESSIONS_HINT}');
      expect(FILTER_SESSIONS_HINT).not.toContain('——');
    });
  });
});
