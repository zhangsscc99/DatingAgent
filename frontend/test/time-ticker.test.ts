/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import {
  FakeEvent,
  installFakeDom,
  type FakeDom,
} from './helpers/fakeDom';
import { startTimeTicker, useTimeTicker } from '../src/hooks/useTimeTicker';

/**
 * P442 — relative-time labels (「刚刚」「N 分钟前」「剩 N 天」) were
 * render-time snapshots: nothing re-rendered the bubble/sidebar/trash
 * rows, so a message pinned at 「刚刚」 forever. useTimeTicker supplies a
 * shared `now` that advances on a minute cadence — paused while the tab
 * is hidden, refreshed the instant it returns, cleaned up on unmount.
 *
 * Behavioural side runs the real hook on the repo fake DOM under vitest
 * fake timers (Date is mocked, so `now` moves deterministically); the
 * wiring side is a source-level assertion that all three call sites pass
 * the ticker's now into formatRelativeTime / trashDaysLeft.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const TICK_MS = 1_000;

/** Records every `now` the hook hands to a render. */
const makeProbe = (seen: number[]) =>
  function Probe() {
    const now = useTimeTicker(TICK_MS);
    seen.push(now);
    return createElement('span', { className: 'probe-now' }, String(now));
  };

describe('P442 · useTimeTicker', () => {
  let dom: FakeDom;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = async (seen: number[]) => {
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    const Probe = makeProbe(seen);
    await act(async () => {
      root.render(createElement(Probe));
      await Promise.resolve();
    });
    return root;
  };

  it('returns the mount-time now on first render and updates it once the interval elapses', async () => {
    const seen: number[] = [];
    await mount(seen);
    expect(seen).toHaveLength(1);
    const first = seen[0];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_MS);
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(first + TICK_MS);
  });

  it('does not tick while document.hidden, then ticks immediately on becoming visible', async () => {
    const seen: number[] = [];
    await mount(seen);

    dom.document.hidden = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    });
    expect(seen, 'no render ticks while hidden').toHaveLength(1);

    dom.document.hidden = false;
    await act(async () => {
      dom.document.dispatchEvent(new FakeEvent('visibilitychange'));
      await Promise.resolve();
    });
    expect(seen, 'one immediate tick on visible').toHaveLength(2);
    // 3 s passed hidden — the catch-up tick reports current time, not +1 s.
    expect(seen.at(-1)).toBe(seen[0] + TICK_MS * 3);
  });

  it('fires no tick on visibilitychange while still hidden', async () => {
    const seen: number[] = [];
    await mount(seen);
    dom.document.hidden = true;
    await act(async () => {
      dom.document.dispatchEvent(new FakeEvent('visibilitychange'));
      await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    });
    expect(seen).toHaveLength(1);
  });

  it('stops updating after unmount', async () => {
    const seen: number[] = [];
    const root = await mount(seen);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_MS);
    });
    const beforeUnmount = seen.length;

    await act(async () => {
      root.unmount();
      await vi.advanceTimersByTimeAsync(TICK_MS * 5);
    });
    expect(seen).toHaveLength(beforeUnmount);
  });

  it('startTimeTicker.stop() silences the interval and the visibility listener', async () => {
    const ticks: number[] = [];
    const handle = startTimeTicker(TICK_MS, (n) => ticks.push(n));
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    const count = ticks.length;
    expect(count).toBeGreaterThan(0);

    handle.stop();
    await vi.advanceTimersByTimeAsync(TICK_MS * 5);
    dom.document.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(ticks).toHaveLength(count);
  });
});

describe('P442 · the three call sites pass the ticked now into the formatters', () => {
  it('MessageBubble renders formatRelativeTime(message.createdAt, now) from useTimeTicker', () => {
    const src = readSrc('components/MessageBubble.tsx');
    expect(src).toMatch(/import \{ useTimeTicker \} from '\.\.\/hooks\/useTimeTicker'/);
    expect(src).toMatch(/const now = useTimeTicker\(\)/);
    expect(src).toMatch(/formatRelativeTime\(message\.createdAt, now\)/);
  });

  it('Sidebar renders formatRelativeTime(s.updatedAt, now) from useTimeTicker', () => {
    const src = readSrc('components/Sidebar.tsx');
    expect(src).toMatch(/import \{ useTimeTicker \} from '\.\.\/hooks\/useTimeTicker'/);
    expect(src).toMatch(/const now = useTimeTicker\(\)/);
    expect(src).toMatch(/formatRelativeTime\(s\.updatedAt, now\)/);
  });

  it('TrashSheet feeds one ticked now to both formatRelativeTime and trashDaysLeft', () => {
    const src = readSrc('components/TrashSheet.tsx');
    expect(src).toMatch(/import \{ useTimeTicker \} from '\.\.\/hooks\/useTimeTicker'/);
    expect(src).toMatch(/const now = useTimeTicker\(\)/);
    expect(src).toMatch(/formatRelativeTime\(entry\.deletedAt, now\)/);
    expect(src).toMatch(/trashDaysLeft\(entry\.deletedAt, now,/);
  });
});
