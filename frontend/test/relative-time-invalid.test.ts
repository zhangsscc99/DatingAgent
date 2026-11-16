/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../src/lib/relativeTime';
import { groupSessionsByDay } from '../src/components/Sidebar';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P186 — a corrupt persisted updatedAt must never render as "20773 天前"
 * (0 treated as epoch 1970) or form a bogus day bucket. Missing, non-finite,
 * non-positive or far-future timestamps render 「时间未知」 and land in 更早;
 * every normal timestamp's output stays identical to before.
 */

// Fixed "now": 2026-11-15 12:00 local, same anchor as session-groups.test.ts.
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const at = (hour: number, dayOffset = 0): number =>
  new Date(2026, 10, 15 + dayOffset, hour).getTime();

const session = (id: string, updatedAt: unknown): StoredChatSession => ({
  id,
  title: id,
  updatedAt: updatedAt as number,
  messages: [{ id: `${id}-u`, role: 'user', content: id } satisfies ChatMessage],
});

describe('P186 · formatRelativeTime rejects corrupt timestamps', () => {
  it('returns 时间未知 for non-finite input', () => {
    expect(formatRelativeTime(Number.NaN, NOW)).toBe('时间未知');
    expect(formatRelativeTime(Number.POSITIVE_INFINITY, NOW)).toBe('时间未知');
    expect(formatRelativeTime(Number.NEGATIVE_INFINITY, NOW)).toBe('时间未知');
  });

  it('returns 时间未知 for missing or non-number input', () => {
    expect(formatRelativeTime(undefined, NOW)).toBe('时间未知');
    expect(formatRelativeTime(null, NOW)).toBe('时间未知');
    expect(formatRelativeTime('2026-11-15T04:00:00Z', NOW)).toBe('时间未知');
  });

  it('returns 时间未知 for 0 and negative timestamps (the 1970 bug)', () => {
    expect(formatRelativeTime(0, NOW)).toBe('时间未知');
    expect(formatRelativeTime(-1, NOW)).toBe('时间未知');
    expect(formatRelativeTime(-86_400_000, NOW)).toBe('时间未知');
  });

  it('returns 时间未知 for timestamps more than a day in the future', () => {
    expect(formatRelativeTime(NOW + 86_400_001, NOW)).toBe('时间未知');
    expect(formatRelativeTime(NOW + 30 * 86_400_000, NOW)).toBe('时间未知');
  });

  it('keeps normal timestamp output identical', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('昨天');
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe('3 天前');
    // Within-skew future (clock drift) renders exactly like before.
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('刚刚');
  });
});

describe('P186 · groupSessionsByDay buckets corrupt timestamps into 更早', () => {
  it('sends 0/negative/NaN/missing/non-number/far-future updatedAt to 更早', () => {
    const corrupt = [
      session('zero', 0),
      session('neg', -5),
      session('nan', Number.NaN),
      session('missing', undefined),
      session('str', 'not-a-number'),
      session('future', NOW + 10 * 86_400_000),
    ];
    const groups = groupSessionsByDay(corrupt, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('更早');
    expect(groups[0].sessions.map((s) => s.id)).toEqual([
      'zero',
      'neg',
      'nan',
      'missing',
      'str',
      'future',
    ]);
  });

  it('a far-future timestamp no longer lands in 今天', () => {
    const groups = groupSessionsByDay(
      [session('f', NOW + 2 * 86_400_000)],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['更早']);
  });

  it('leaves normal 今天/昨天/更早 grouping untouched', () => {
    const groups = groupSessionsByDay(
      [
        session('t', at(9)),
        session('y', at(20, -1)),
        session('o', at(9, -5)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '更早']);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['t']);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['y']);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(['o']);
  });
});
