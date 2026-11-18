/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import { formatAbsolute, trashDaysLeft } from '../src/lib/absoluteTime';
import { TRASH_TTL_MS } from '../src/lib/chatTrash';
import type { TrashEntry } from '../src/lib/chatTrash';
import type { ChatMessage } from '../src/types';

/**
 * P329 — bubbles and the recycle bin only ever showed relative times
 * (「3 分钟前」), so the exact date of a reply and each trashed chat's own
 * countdown were nowhere to be found. The bubble's age label is now a real
 * <time dateTime title> — hover/long-press surfaces 「11月18日 16:52」 — and
 * every trash row appends 「· 剩 N 天」 computed against TRASH_TTL_MS.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Local-time constructor keeps the expected string TZ-independent. */
const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).getTime();

describe('P329 · formatAbsolute', () => {
  const NOW = local(2026, 11, 18, 20, 0);

  it('renders a same-year timestamp as 「M月D日 HH:MM」', () => {
    expect(formatAbsolute(local(2026, 11, 18, 16, 52), NOW)).toBe(
      '11月18日 16:52',
    );
    // zero-padded clock, unpadded month/day
    expect(formatAbsolute(local(2026, 1, 5, 9, 5), NOW)).toBe('1月5日 09:05');
  });

  it('prefixes the year when the timestamp sits in a different year', () => {
    expect(formatAbsolute(local(2025, 12, 3, 9, 5), NOW)).toBe(
      '2025年12月3日 09:05',
    );
  });

  it('returns an empty string for non-renderable timestamps', () => {
    for (const bad of [NaN, Infinity, 0, -5, 'x', null, undefined, {}]) {
      expect(formatAbsolute(bad, NOW)).toBe('');
    }
    // beyond the one-day clock-skew allowance → treated as corrupt
    expect(formatAbsolute(NOW + DAY + 1, NOW)).toBe('');
  });
});

describe('P329 · trashDaysLeft', () => {
  const NOW = 1_800_000_000_000;
  const TTL = TRASH_TTL_MS; // 7 days

  it('a just-deleted entry has the full window left', () => {
    expect(trashDaysLeft(NOW, NOW, TTL)).toBe(7);
    expect(trashDaysLeft(NOW - HOUR, NOW, TTL)).toBe(7); // 1 h old → still 7
  });

  it('rounds any fraction of a remaining day up to 1', () => {
    // 6天23小时 old → exactly one hour remains
    expect(trashDaysLeft(NOW - (6 * 24 + 23) * HOUR, NOW, TTL)).toBe(1);
    // a half-hour of life left still reads 「剩 1 天」
    expect(trashDaysLeft(NOW - (TTL - HOUR / 2), NOW, TTL)).toBe(1);
    expect(trashDaysLeft(NOW - (TTL - 1), NOW, TTL)).toBe(1);
  });

  it('clamps expired entries to 0', () => {
    expect(trashDaysLeft(NOW - TTL, NOW, TTL)).toBe(0);
    expect(trashDaysLeft(NOW - TTL - DAY, NOW, TTL)).toBe(0);
  });
});

describe('P329 · rendered absolute time', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const CREATED = Date.now() - 3 * HOUR;
  const GOOD: ChatMessage = {
    id: 'm-good',
    role: 'assistant',
    content: '带时间的回复。',
    createdAt: CREATED,
    meta: { tokens: 40, latencyMs: 2000 },
  };
  const BROKEN: ChatMessage = {
    id: 'm-broken',
    role: 'assistant',
    content: '坏时间戳的回复。',
    createdAt: 0,
    meta: { tokens: 20, latencyMs: 1000 },
  };
  const ENTRY: TrashEntry = {
    sessionId: 's-trash',
    title: '三天前删掉的对话',
    messages: [],
    deletedAt: Date.now() - (2 * 24 + 3) * HOUR, // 4天21小时 left → 剩 5 天
    messageCount: 3,
  };

  const metaRows = () =>
    Array.from(dom.document.querySelectorAll('.reply-meta')) as FakeElement[];
  const attr = (el: FakeElement, name: string) =>
    el.getAttribute(name) ?? el.getAttribute(name.toLowerCase());

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: MessageBubble } = await import(
      '../src/components/MessageBubble'
    );
    const { default: TrashSheet } = await import(
      '../src/components/TrashSheet'
    );

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(
          'div',
          null,
          createElement(MessageBubble, { message: GOOD }),
          createElement(MessageBubble, { message: BROKEN }),
          createElement(TrashSheet, {
            open: true,
            entries: [ENTRY],
            onClose: () => {},
            onRestore: () => {},
            onClearAll: () => {},
          }),
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(async () => {
    if (root) {
      const r = root;
      root = null;
      await act(async () => {
        r.unmount();
      });
    }
  });

  it('the bubble age is a <time> carrying dateTime and a non-empty title', () => {
    const row = metaRows()[0];
    expect(row, 'meta row').toBeTruthy();
    const time = row.querySelector('time');
    expect(time, 'time element').toBeTruthy();
    expect(attr(time!, 'dateTime')).toBe(new Date(CREATED).toISOString());
    const title = time!.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).toBe(formatAbsolute(CREATED));
    // the visible text is still the relative label — no layout change
    expect(time!.textContent).toBe('3 小时前');
  });

  it('a corrupt timestamp falls back to the plain span — never title=""', () => {
    const row = metaRows()[1];
    expect(row, 'broken meta row').toBeTruthy();
    expect(row.querySelector('time')).toBeNull();
    expect(row.querySelector('[title=""]')).toBeNull();
    const span = row.querySelector('span');
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe('刚刚');
    expect(span!.getAttribute('title')).toBeNull();
  });

  it('each trash row keeps its relative stamp and appends 剩 N 天', () => {
    const meta = dom.document.querySelector('.trash-row-meta');
    expect(meta, 'trash meta').toBeTruthy();
    expect(meta!.textContent).toBe('3 条消息 · 删除于 2 天前 · 剩 5 天');
  });
});
