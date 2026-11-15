/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filterRecentSessions } from '../src/components/Sidebar';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P150 — sidebar 最近对话 filter contract. Source-level guards (same approach
 * as delete-session.test.ts) lock in the input wiring; the behavioural block
 * exercises the exported filterRecentSessions helper that the component maps
 * over (vitest runs in node, no DOM renderer).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const session = (id: string, title: string, updatedAt: number): StoredChatSession => ({
  id,
  title,
  updatedAt,
  messages: [{ id: `${id}-u`, role: 'user', content: title } satisfies ChatMessage],
});

const SESSIONS: StoredChatSession[] = [
  session('s1', '周末Cat约会', 300),
  session('s2', 'The Restaurant chat', 200),
  session('s3', '资料the catch建议', 100),
];

describe('P150 · sidebar session filter', () => {
  describe('source guards', () => {
    it('renders a labelled filter input directly above the recent-chat list', () => {
      const sidebar = read('components/Sidebar.tsx');
      const input = sidebar.indexOf('recent-chat-filter');
      const list = sidebar.indexOf('className="recent-chat-list"');
      expect(input).toBeGreaterThan(-1);
      expect(list).toBeGreaterThan(input);
      expect(sidebar).toContain('aria-label="筛选对话"');
      expect(sidebar).toContain('onChange={(e) => setFilterQuery(e.target.value)}');
    });

    it('keeps the filter read-only (never disabled by busy)', () => {
      const sidebar = read('components/Sidebar.tsx');
      const input = sidebar.slice(
        sidebar.indexOf('recent-chat-filter'),
        sidebar.indexOf('className="recent-chat-list"'),
      );
      expect(input).not.toContain('disabled');
      expect(input).not.toContain('busy');
    });

    it('clears the query and blurs on Escape', () => {
      const sidebar = read('components/Sidebar.tsx');
      const input = sidebar.slice(
        sidebar.indexOf('recent-chat-filter'),
        sidebar.indexOf('className="recent-chat-list"'),
      );
      expect(input).toContain("e.key === 'Escape'");
      expect(input).toContain("setFilterQuery('')");
      expect(input).toContain('blur()');
    });

    it('shows a dim 无匹配对话 row inside the list while the section stays mounted', () => {
      const sidebar = read('components/Sidebar.tsx');
      const list = sidebar.slice(sidebar.indexOf('className="recent-chat-list"'));
      expect(list).toContain('无匹配对话');
      expect(list.indexOf('无匹配对话')).toBeLessThan(list.indexOf('</ul>'));
      // The section is gated only on stored sessions existing, never on the query.
      expect(sidebar).toContain('{recentSessions.length > 0 && (');
    });

    it('filters over a stable copy and keeps rename state keyed per row', () => {
      const sidebar = read('components/Sidebar.tsx');
      // P151 groups the filtered list; rows now map per group over it.
      expect(sidebar).toContain('group.sessions.map((s) =>');
      expect(sidebar).toContain('groupSessionsByDay(visibleSessions)');
      expect(sidebar).toContain('filterRecentSessions(recentSessions, filterQuery)');
      // Rename/edit state is keyed to the session id, so a changed filter can
      // never attach an edit box to a different row.
      expect(sidebar).toContain('editingId === s.id');
      expect(sidebar).toContain('key={s.id}');
    });
  });

  describe('filterRecentSessions behaviour', () => {
    it('narrows the list to case-insensitive title substring matches', () => {
      expect(filterRecentSessions(SESSIONS, '约会').map((s) => s.id)).toEqual(['s1']);
      expect(filterRecentSessions(SESSIONS, 'RESTAURANT').map((s) => s.id)).toEqual(['s2']);
    });

    it('returns the full list untouched for empty or whitespace queries', () => {
      expect(filterRecentSessions(SESSIONS, '')).toBe(SESSIONS);
      expect(filterRecentSessions(SESSIONS, '   ')).toBe(SESSIONS);
      // Clearing after a query restores every session.
      expect(filterRecentSessions(SESSIONS, 'zzz')).toHaveLength(0);
      expect(filterRecentSessions(SESSIONS, '')).toHaveLength(3);
    });

    it('returns [] when nothing matches so the UI renders the empty row', () => {
      expect(filterRecentSessions(SESSIONS, '不存在的对话')).toEqual([]);
    });

    it('trims the query before matching', () => {
      expect(filterRecentSessions(SESSIONS, '  约会  ').map((s) => s.id)).toEqual(['s1']);
    });

    it('preserves original recency order and does not mutate the input', () => {
      const before = [...SESSIONS];
      const hits = filterRecentSessions(SESSIONS, 'cat');
      expect(hits.map((s) => s.id)).toEqual(['s1', 's3']);
      expect(SESSIONS).toEqual(before);
    });
  });
});
