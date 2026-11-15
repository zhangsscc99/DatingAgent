/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { formatLatencySeconds, formatRelativeTime } from '../src/lib/relativeTime';

/**
 * P63 — shared relative-time / latency util. Thresholds and strings are the
 * ones Sidebar used to carry privately; `now` is injectable so the clock is
 * fixed for tests.
 */

const NOW = 1_700_000_000_000;
const ago = (ms: number) => NOW - ms;

describe('P63 · formatRelativeTime', () => {
  it('returns 刚刚 below one minute', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('刚刚');
    expect(formatRelativeTime(ago(59_999), NOW)).toBe('刚刚');
  });

  it('returns N 分钟前 for 1–59 minutes', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 分钟前');
    expect(formatRelativeTime(ago(59 * 60_000), NOW)).toBe('59 分钟前');
  });

  it('returns N 小时前 for 1–23 hours', () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1 小时前');
    expect(formatRelativeTime(ago(23 * 60 * 60_000), NOW)).toBe('23 小时前');
  });

  it('returns 昨天 for exactly one day', () => {
    expect(formatRelativeTime(ago(24 * 60 * 60_000), NOW)).toBe('昨天');
  });

  it('returns N 天前 for two days and beyond', () => {
    expect(formatRelativeTime(ago(2 * 24 * 60 * 60_000), NOW)).toBe('2 天前');
    expect(formatRelativeTime(ago(30 * 24 * 60 * 60_000), NOW)).toBe('30 天前');
  });
});

describe('P63 · formatLatencySeconds', () => {
  it('matches the rendered meta badge text', () => {
    expect(formatLatencySeconds(0)).toBe('0.0s');
    expect(formatLatencySeconds(1234)).toBe('1.2s');
  });
});
