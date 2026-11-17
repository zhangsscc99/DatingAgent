/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import { describe, expect, it } from 'vitest';
import { shouldShowFilterEmptyHint } from '../src/lib/sidebarListState';
import { filterRecentSessions } from '../src/lib/sessionFilter';
import type { StoredChatSession } from '../src/lib/chatStorage';
import { installFakeDom } from './helpers/fakeDom';

/**
 * P245 — sidebar filter must render a single empty state. A non-matching
 * query used to paint the query-aware filter-empty-hint li AND a second
 * generic 没有匹配的对话 copy in the live-region announcement, so the
 * sidebar showed two empty states at once. The generic branch is gone;
 * vitest runs in node (no DOM), so behavioural blocks exercise the pure
 * predicate/matcher and source guards lock in that the no-match copy
 * exists exactly once, inside the hint that carries the query term.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const session = (id: string, title: string): StoredChatSession => ({
  id,
  title,
  updatedAt: 1,
  messages: [],
});

describe('P245 · sidebar collapses duplicate filter empty state', () => {
  const sessions = [
    session('s1', '周末约会计划'),
    session('s2', '资料优化建议'),
    session('s3', '聊天回复'),
  ];

  describe('a query with zero matches shows exactly one empty state', () => {
    it('the query-aware hint is the sole 没有匹配 copy in the component', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar.match(/没有匹配/g)).toHaveLength(1);
      expect(sidebar).toContain('没有匹配「{filterQuery.trim()}」的对话');
    });

    it('a non-matching query empties the list and surfaces the single hint', () => {
      const visible = filterRecentSessions(sessions, 'zzz不存在');
      expect(visible).toHaveLength(0);
      expect(shouldShowFilterEmptyHint(sessions.length, visible.length)).toBe(
        true,
      );
    });

    it('the live region stays silent on zero matches instead of a generic copy', () => {
      const sidebar = read('components/Sidebar.tsx');
      const start = sidebar.indexOf('role="status" aria-live="polite"');
      const region = sidebar.slice(start, sidebar.indexOf('</span>', start));
      expect(region).toContain('visibleSessions.length > 0');
      expect(region).not.toContain('没有匹配');
    });
  });

  describe('an empty query keeps the no-query path intact', () => {
    it('a blank query restores every session and hides the hint', () => {
      const visible = filterRecentSessions(sessions, '');
      expect(visible).toHaveLength(sessions.length);
      expect(shouldShowFilterEmptyHint(sessions.length, visible.length)).toBe(
        false,
      );
    });

    it('a genuinely empty history never claims a filter is hiding rows', () => {
      expect(shouldShowFilterEmptyHint(0, 0)).toBe(false);
    });

    it('the live region is gated on a non-empty query', () => {
      const sidebar = read('components/Sidebar.tsx');
      const start = sidebar.indexOf('role="status" aria-live="polite"');
      const region = sidebar.slice(start, sidebar.indexOf('</span>', start));
      expect(region).toContain('filterQuery.trim() &&');
      expect(region).toContain("''}");
    });
  });
});

/**
 * P247 — with zero stored sessions the whole 最近对话 section used to
 * vanish (heading included), leaving only 快捷入口 and 工具. The section
 * now always renders; the list slot carries one dim line instead.
 * Source guards pin the copy to a single occurrence, and a fake-DOM mount
 * proves the line renders exactly once with no second empty state.
 */
describe('P247 · zero-session sidebar keeps heading + one dim line', () => {
  it('the zero-session copy exists exactly once in the component', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar.match(/还没有对话/g)).toHaveLength(1);
    expect(sidebar).toContain('还没有对话，问第一个问题吧');
  });

  it('the 最近对话 section is no longer gated on a non-empty list', () => {
    const sidebar = read('components/Sidebar.tsx');
    // The section renders unconditionally — only the <ul> is gated, so the
    // heading (and the P187 filter hint gating) keep working while the
    // zero-session branch fills the list slot.
    const section = sidebar.slice(sidebar.indexOf('recent-chats'));
    expect(section).toContain('aria-label="最近对话"');
    expect(sidebar).not.toContain('{recentSessions.length > 0 && (\n        <section');
    expect(sidebar).toContain('recentSessions.length === 0');
  });

  const mountSidebar = async (recentSessions: StoredChatSession[]) => {
    const dom = installFakeDom();
    const [{ createRoot }, { default: Sidebar }] = await Promise.all([
      import('react-dom/client'),
      import('../src/components/Sidebar'),
    ]);
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(Sidebar, {
          tools: [],
          recentSessions,
          onQuickPrompt: () => {},
          onNewChat: () => {},
        }),
      );
    });
    return { dom, root };
  };

  it('mounted: zero sessions renders the heading plus exactly one empty line', async () => {
    const { dom, root } = await mountSidebar([]);
    const section = dom.document.querySelector('[aria-label="最近对话"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain('最近对话');
    const empty = dom.document.querySelectorAll('.recent-chat-empty');
    expect(empty).toHaveLength(1);
    expect(empty[0].textContent).toBe('还没有对话，问第一个问题吧');
    // No second empty state came back: the P245 filter hint stays off
    // (it requires stored sessions), and no generic copy exists.
    expect(dom.document.querySelectorAll('.filter-empty-hint')).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
  });

  it('mounted: with sessions the dim line is absent and the list renders', async () => {
    const { dom, root } = await mountSidebar([
      session('s1', '周末约会计划'),
      session('s2', '资料优化建议'),
    ]);
    expect(dom.document.querySelectorAll('.recent-chat-empty')).toHaveLength(0);
    expect(
      dom.document.querySelectorAll('.recent-chat-item'),
    ).toHaveLength(2);
    await act(async () => {
      root.unmount();
    });
  });
});
