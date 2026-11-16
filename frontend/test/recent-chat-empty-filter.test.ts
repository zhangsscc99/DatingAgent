/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowFilterEmptyHint } from '../src/lib/sidebarListState';
import { filterRecentSessions } from '../src/lib/sessionFilter';
import type { StoredChatSession } from '../src/lib/chatStorage';

/**
 * P187 — sidebar filter empty-state hint contract. vitest runs in the node
 * environment (no DOM renderer), so the behavioural block exercises the pure
 * shouldShowFilterEmptyHint predicate plus the real filterRecentSessions
 * matcher, and source guards (same approach as session-filter.test.ts) lock
 * in the Sidebar wiring: the hint text, the 清除筛选 button and the
 * setFilterQuery('') restore path.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const session = (id: string, title: string): StoredChatSession => ({
  id,
  title,
  updatedAt: 1,
  messages: [],
});

describe('P187 · sidebar filter empty-state hint', () => {
  describe('shouldShowFilterEmptyHint', () => {
    it('is true when sessions exist but the filter emptied the list', () => {
      expect(shouldShowFilterEmptyHint(3, 0)).toBe(true);
      expect(shouldShowFilterEmptyHint(1, 0)).toBe(true);
    });

    it('is false when the filtered list still has matches', () => {
      expect(shouldShowFilterEmptyHint(3, 1)).toBe(false);
      expect(shouldShowFilterEmptyHint(3, 3)).toBe(false);
    });

    it('is false when the session list itself is empty', () => {
      expect(shouldShowFilterEmptyHint(0, 0)).toBe(false);
    });
  });

  describe('filter + predicate together', () => {
    const sessions = [
      session('s1', '周末约会计划'),
      session('s2', '资料优化建议'),
      session('s3', '聊天回复'),
    ];

    it('a non-matching query empties the visible list and shows the hint', () => {
      const visible = filterRecentSessions(sessions, '不存在的对话');
      expect(visible).toHaveLength(0);
      expect(shouldShowFilterEmptyHint(sessions.length, visible.length)).toBe(
        true,
      );
    });

    it('a matching query keeps the hint hidden', () => {
      const visible = filterRecentSessions(sessions, '约会');
      expect(visible).toHaveLength(1);
      expect(shouldShowFilterEmptyHint(sessions.length, visible.length)).toBe(
        false,
      );
    });

    it('clearing the query restores the full list and hides the hint', () => {
      const restored = filterRecentSessions(sessions, '');
      expect(restored).toHaveLength(3);
      expect(shouldShowFilterEmptyHint(sessions.length, restored.length)).toBe(
        false,
      );
    });
  });

  describe('source guards', () => {
    const sidebar = read('components/Sidebar.tsx');
    const listBlock = sidebar.slice(
      sidebar.indexOf('className="recent-chat-list"'),
      sidebar.indexOf('</ul>'),
    );

    it('renders the hint inside the list with the current query in the copy', () => {
      expect(listBlock).toContain('filter-empty-hint');
      expect(listBlock).toContain('没有匹配「{filterQuery.trim()}」的对话');
      expect(listBlock).toContain('aria-live="polite"');
    });

    it('says 无匹配 exactly once — the heading is merged into the hint, not repeated', () => {
      const hintBlock = listBlock.slice(
        listBlock.indexOf('filter-empty-hint'),
        listBlock.indexOf('</li>'),
      );
      expect(hintBlock.match(/无匹配/g)).toHaveLength(1);
      expect(listBlock).not.toContain('无匹配对话：');
      expect(listBlock).not.toContain('sr-only');
    });

    it('renders a labelled 清除筛选 secondary button next to the hint', () => {
      expect(listBlock).toContain('className="filter-empty-clear"');
      expect(listBlock).toContain('aria-label="清除筛选"');
      expect(listBlock).toContain('清除筛选');
      const btn = listBlock.slice(listBlock.indexOf('filter-empty-clear'));
      expect(btn.slice(0, btn.indexOf('</button>'))).toContain(
        "onClick={() => setFilterQuery('')}",
      );
    });

    it('gates the hint on shouldShowFilterEmptyHint so empty history stays silent', () => {
      expect(sidebar).toContain(
        'shouldShowFilterEmptyHint(\n              recentSessions.length,\n              visibleSessions.length,\n            )',
      );
      expect(sidebar).toContain('shouldShowFilterEmptyHint');
      // The session section itself is still gated on stored sessions, so a
      // truly empty history never reaches the hint.
      expect(sidebar).toContain('{recentSessions.length > 0 && (');
    });

    it('keeps the dim empty-row styling and the clear button styles', () => {
      expect(listBlock).toContain('recent-chat-empty');
      const css = read('components/Sidebar.css');
      expect(css).toContain('.filter-empty-hint');
      expect(css).toContain('.filter-empty-clear');
      expect(css).toContain('.filter-empty-clear:hover');
      expect(css).toContain('.filter-empty-clear:focus-visible');
    });
  });
});
