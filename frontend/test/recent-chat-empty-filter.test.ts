/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FILTER_SESSIONS_HINT } from '../src/lib/searchLabels';
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

    it('copy matches behaviour: a body-only hit is found, and the hint says so (P278)', () => {
      const bodyOnly: StoredChatSession = {
        id: 's9',
        title: '我今天很顺利约到她周末一起去看展了，开心…',
        updatedAt: 1,
        messages: [
          {
            id: 's9-u',
            role: 'user',
            content: '她两条消息都没回我了，心里很难受，睡不着。',
          },
        ],
      };
      const visible = filterRecentSessions([bodyOnly], '睡不着');
      expect(visible).toHaveLength(1);
      expect(FILTER_SESSIONS_HINT).toContain('内容');
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
      expect(listBlock).toContain('没有一段对话匹配「{filterQuery.trim()}」');
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

    it('orders the empty state 提示 → 说明 → 清除筛选, and the scope copy names 标题', () => {
      const hintAt = listBlock.indexOf('filter-empty-hint');
      const li = listBlock.slice(hintAt, listBlock.indexOf('</li>', hintAt));
      expect(li.indexOf('filter-empty-hint-text')).toBeGreaterThanOrEqual(0);
      expect(li.indexOf('filter-empty-hint-scope')).toBeGreaterThan(
        li.indexOf('filter-empty-hint-text'),
      );
      expect(li.indexOf('filter-empty-clear')).toBeGreaterThan(
        li.indexOf('filter-empty-hint-scope'),
      );
      // The scope explanation sits inside the first sentence and honestly
      // names the real scope: titles AND message bodies (P278).
      const scope = li.slice(
        li.indexOf('filter-empty-hint-scope'),
        li.indexOf('filter-empty-clear'),
      );
      expect(scope).toContain('FILTER_SESSIONS_HINT');
      expect(FILTER_SESSIONS_HINT).toContain('标题');
      expect(FILTER_SESSIONS_HINT).toContain('对话内容');
      expect(FILTER_SESSIONS_HINT).not.toContain('只筛选最近对话标题');
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
      // P298: whitespace-tolerant — the call moved one level deeper when the
      // sidebar list gained its own .sidebar-body scroll region.
      expect(sidebar).toMatch(
        /shouldShowFilterEmptyHint\(\s*recentSessions\.length,\s*visibleSessions\.length,\s*\)/,
      );
      expect(sidebar).toContain('shouldShowFilterEmptyHint');
      // The session section itself is still gated on stored sessions, so a
      // truly empty history never reaches the hint.
      expect(sidebar).toContain('{recentSessions.length > 0 && (');
    });

    it('guarantees the hint text a full-width row so it can never collapse to a sliver', () => {
      const css = read('components/Sidebar.css');
      const textBlock = css.slice(
        css.indexOf('.filter-empty-hint-text'),
        css.indexOf('}', css.indexOf('.filter-empty-hint-text')),
      );
      // Regression guard (P275 fix): the text span must claim the whole first
      // row of the wrapped flex container — either via flex-basis: 100% /
      // width: 100% here, or by the container being flex-direction: column.
      // A plain `flex: 1` sibling of the button collapses to ~10px at 320px.
      const containerBlock = css.slice(
        css.indexOf('.filter-empty-hint {'),
        css.indexOf('}', css.indexOf('.filter-empty-hint {')),
      );
      const ownsFullRow =
        /flex-basis:\s*100%|width:\s*100%|flex:\s*1\s+1\s+100%/.test(textBlock);
      const isColumn = /flex-direction:\s*column/.test(containerBlock);
      expect(ownsFullRow || isColumn).toBe(true);
      expect(textBlock).not.toMatch(/flex:\s*1\s*;/);
      expect(textBlock).not.toMatch(/flex:\s*1\s+1\s+0%/);
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
