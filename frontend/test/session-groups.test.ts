/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filterRecentSessions, groupSessionsByDay } from '../src/components/Sidebar';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P151 — group the sidebar 最近对话 list by local calendar day. Source-level
 * guards lock in the wiring (filter first, then group; headings stay inert);
 * the behavioural block exercises the exported groupSessionsByDay helper with
 * a fixed injected `now` — every timestamp is built in local time so the suite
 * is timezone-independent and never touches the real clock.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

// Fixed "now": 2026-11-15 12:00 local.
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const at = (hour: number, minute = 0, dayOffset = 0): number =>
  new Date(2026, 10, 15 + dayOffset, hour, minute).getTime();

const session = (id: string, title: string, updatedAt: number): StoredChatSession => ({
  id,
  title,
  updatedAt,
  messages: [{ id: `${id}-u`, role: 'user', content: title } satisfies ChatMessage],
});

const labels = (sessions: StoredChatSession[], now = NOW) =>
  groupSessionsByDay(sessions, now).map((g) => g.label);
const ids = (sessions: StoredChatSession[]) => sessions.map((s) => s.id);

describe('P151 · group 最近对话 by day', () => {
  describe('source guards', () => {
    it('exports groupSessionsByDay and feeds it the already-filtered list', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain('export function groupSessionsByDay(');
      expect(sidebar).toContain('filterRecentSessions(recentSessions, filterQuery)');
      expect(sidebar).toContain('groupSessionsByDay(visibleSessions)');
    });

    it('renders an inert group heading li inside the recent-chat list', () => {
      const sidebar = read('components/Sidebar.tsx');
      const list = sidebar.indexOf('className="recent-chat-list"');
      const group = sidebar.indexOf('recent-chat-group');
      expect(list).toBeGreaterThan(-1);
      expect(group).toBeGreaterThan(list);
      const match = sidebar.match(/<li className="recent-chat-group">[\s\S]*?<\/li>/);
      const heading = match ? match[0] : '';
      expect(heading).toContain('{group.label}');
      expect(heading).not.toContain('button');
      expect(heading).not.toContain('onClick');
      expect(heading).not.toContain('tabIndex');
      expect(heading).not.toContain('aria-pressed');
    });

    it('keeps session rows keyed per session id so rename state cannot leak across groups', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain('key={s.id}');
      expect(sidebar).toContain('editingId === s.id');
    });

    it('keeps the 无匹配对话 empty row for zero filter matches', () => {
      const sidebar = read('components/Sidebar.tsx');
      const list = sidebar.slice(sidebar.indexOf('className="recent-chat-list"'));
      expect(list).toContain('无匹配对话');
      expect(list.indexOf('无匹配对话')).toBeLessThan(list.indexOf('</ul>'));
    });
  });

  describe('groupSessionsByDay behaviour', () => {
    it('buckets same-calendar-day sessions into 今天', () => {
      const groups = groupSessionsByDay(
        [session('a', 't', at(0)), session('b', 't', at(23, 59))],
        NOW,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('今天');
      expect(ids(groups[0].sessions)).toEqual(['a', 'b']);
    });

    it('compares calendar days, not 24h spans: yesterday 23:59 is 昨天, today 00:01 is 今天', () => {
      const groups = groupSessionsByDay(
        [session('today', 't', at(0, 1)), session('yday', 't', at(23, 59, -1))],
        NOW,
      );
      expect(groups.map((g) => g.label)).toEqual(['今天', '昨天']);
      expect(ids(groups[0].sessions)).toEqual(['today']);
      expect(ids(groups[1].sessions)).toEqual(['yday']);
    });

    it('buckets anything older than yesterday into 更早', () => {
      const groups = groupSessionsByDay(
        [
          session('two-days', 't', at(0, 0, -2)),
          session('ancient', 't', new Date(2020, 0, 1).getTime()),
        ],
        NOW,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('更早');
      expect(ids(groups[0].sessions)).toEqual(['two-days', 'ancient']);
    });

    it('returns groups in 今天 → 昨天 → 更早 order regardless of input interleave', () => {
      const groups = groupSessionsByDay(
        [
          session('old', 't', at(10, 0, -3)),
          session('today', 't', at(9)),
          session('yday', 't', at(20, 0, -1)),
        ],
        NOW,
      );
      expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '更早']);
    });

    it('omits empty groups', () => {
      expect(labels([session('t', 't', at(9)), session('o', 't', at(9, 0, -4))])).toEqual([
        '今天',
        '更早',
      ]);
      expect(labels([session('y', 't', at(9, 0, -1))])).toEqual(['昨天']);
    });

    it('preserves incoming row order exactly within each group', () => {
      const groups = groupSessionsByDay(
        [
          session('t1', 't', at(8)),
          session('y1', 't', at(8, 0, -1)),
          session('t2', 't', at(10)),
          session('o1', 't', at(8, 0, -2)),
          session('y2', 't', at(20, 0, -1)),
        ],
        NOW,
      );
      expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '更早']);
      expect(ids(groups[0].sessions)).toEqual(['t1', 't2']);
      expect(ids(groups[1].sessions)).toEqual(['y1', 'y2']);
      expect(ids(groups[2].sessions)).toEqual(['o1']);
    });

    it('does not mutate the input array', () => {
      const input = [
        session('y', 't', at(9, 0, -1)),
        session('t', 't', at(9)),
        session('o', 't', at(9, 0, -2)),
      ];
      const before = [...input];
      groupSessionsByDay(input, NOW);
      expect(input).toEqual(before);
    });

    it('returns [] for empty input', () => {
      expect(groupSessionsByDay([], NOW)).toEqual([]);
    });

    it('sends invalid or missing updatedAt to 更早 without throwing', () => {
      const nan = session('nan', 't', Number.NaN);
      const missing = {
        ...session('missing', 't', at(9)),
        updatedAt: undefined as unknown as number,
      };
      const infinite = session('inf', 't', Number.POSITIVE_INFINITY);
      let groups: ReturnType<typeof groupSessionsByDay> = [];
      expect(() => {
        groups = groupSessionsByDay([nan, missing, infinite], NOW);
      }).not.toThrow();
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('更早');
      expect(ids(groups[0].sessions)).toEqual(['nan', 'missing', 'inf']);
    });

    it('defaults its clock to Date.now() when now is not injected', () => {
      const groups = groupSessionsByDay([session('live', 't', Date.now())]);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('今天');
    });

    it('composes with filterRecentSessions: groups are recomputed from matches only', () => {
      const sessions = [
        session('t1', '约会安排', at(9)),
        session('y1', 'restaurant pick', at(20, 0, -1)),
        session('t2', '约会地点', at(10)),
        session('o1', '约会复盘', at(0, 0, -5)),
      ];
      const groups = groupSessionsByDay(filterRecentSessions(sessions, '约会'), NOW);
      expect(groups.map((g) => g.label)).toEqual(['今天', '更早']);
      expect(ids(groups[0].sessions)).toEqual(['t1', 't2']);
      expect(ids(groups[1].sessions)).toEqual(['o1']);
      // A query that matches nothing yields no groups at all.
      expect(groupSessionsByDay(filterRecentSessions(sessions, 'zzz'), NOW)).toEqual([]);
    });
  });
});
