import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  buildConversationMarkdown,
  formatTimestamp,
  formatUtcOffset,
} from '../src/lib/exportConversation';

/**
 * P182 — exported Markdown timestamps carried `YYYY-MM-DD HH:MM` in local
 * time with no zone marker, so a .md shared across devices was ambiguous.
 * These tests lock the appended `UTC±HH:MM` suffix: sign correctness for
 * negative offsets, zero-padded minutes, and the header line carrying it.
 */

const LF = String.fromCharCode(10);

function stubOffset(minutesEastOfUtc: number): void {
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(
    -minutesEastOfUtc,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P182 · formatUtcOffset', () => {
  it('renders UTC+08:00 for a +480 minute offset', () => {
    stubOffset(480);
    expect(formatUtcOffset(new Date(0))).toBe('UTC+08:00');
  });

  it('renders UTC+00:00 at the prime meridian', () => {
    stubOffset(0);
    expect(formatUtcOffset(new Date(0))).toBe('UTC+00:00');
  });

  it('keeps the minus sign for offsets west of UTC', () => {
    stubOffset(-300);
    expect(formatUtcOffset(new Date(0))).toBe('UTC-05:00');
  });

  it('zero-pads partial-hour offsets', () => {
    stubOffset(345);
    expect(formatUtcOffset(new Date(0))).toBe('UTC+05:45');
    stubOffset(-90);
    expect(formatUtcOffset(new Date(0))).toBe('UTC-01:30');
  });
});

describe('P182 · exported timestamps carry the zone suffix', () => {
  it('formatTimestamp appends the local UTC offset', () => {
    stubOffset(480);
    expect(formatTimestamp(new Date(2026, 10, 16, 8, 29).getTime())).toBe(
      '2026-11-16 08:29 (UTC+08:00)',
    );
  });

  it('the Markdown header line contains the offset suffix', () => {
    stubOffset(480);
    const md = buildConversationMarkdown([], {
      exportedAt: new Date(2026, 10, 16, 8, 29).getTime(),
    });
    expect(md.split(LF)[2]).toBe('- 导出时间：2026-11-16 08:29 (UTC+08:00)');
  });

  it('per-message timestamps carry the suffix too', () => {
    stubOffset(-300);
    const createdAt = new Date(2026, 10, 16, 9, 0).getTime();
    const message: ChatMessage = {
      id: `u-${createdAt}`,
      role: 'user',
      content: 'hi',
      createdAt,
    };
    const md = buildConversationMarkdown([message], { exportedAt: createdAt });
    expect(md).toContain('## 你 · 2026-11-16 09:00 (UTC-05:00)');
  });
});
