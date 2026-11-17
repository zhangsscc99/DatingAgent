/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowFilterEmptyHint } from '../src/lib/sidebarListState';
import { filterRecentSessions } from '../src/lib/sessionFilter';
import type { StoredChatSession } from '../src/lib/chatStorage';

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
