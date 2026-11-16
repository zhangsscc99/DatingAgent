/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEALTH_POLL_MAX_DELAY_MS,
  nextDelayMs,
  startHealthPoll,
  type HealthPollHandle,
} from '../src/hooks/useHealthPoll';
import type { HealthSnapshot } from '../src/lib/healthStatus';

/**
 * P178 — the P123 claim (backoff after a failed health poll, doubling up to a
 * 5-minute cap, reset on success) was never shipped: the hook ran a constant
 * setInterval. These tests lock the real behaviour: nextDelayMs is the pure
 * rule and startHealthPoll self-reschedules via setTimeout with that delay.
 * Same node-env DOM stub as health-poll-visibility.test.ts; fake timers only.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const BASE = 60_000;

const setHidden = (doc: EventTarget, hidden: boolean) => {
  Object.defineProperty(doc, 'hidden', { value: hidden, configurable: true });
};

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  }) as Response;

describe('P178 · nextDelayMs pure scheduling rule', () => {
  it('returns the base interval with no failures, then doubles per failure', () => {
    expect(nextDelayMs(0, BASE)).toBe(60_000);
    expect(nextDelayMs(1, BASE)).toBe(120_000);
    expect(nextDelayMs(2, BASE)).toBe(240_000);
  });

  it('caps at five minutes from the third failure onward', () => {
    expect(nextDelayMs(3, BASE)).toBe(300_000);
    expect(nextDelayMs(5, BASE)).toBe(300_000);
    expect(nextDelayMs(30, BASE)).toBe(300_000);
    expect(nextDelayMs(1_000_000, BASE)).toBe(300_000);
    expect(HEALTH_POLL_MAX_DELAY_MS).toBe(300_000);
  });

  it('resets to the base interval once failures are cleared (success => n=0)', () => {
    expect(nextDelayMs(4, BASE)).toBe(300_000);
    expect(nextDelayMs(0, BASE)).toBe(60_000);
  });

  it('never returns NaN/Infinity/negative/0 for degenerate inputs', () => {
    const degenerate: Array<[number, number]> = [
      [NaN, BASE],
      [-1, BASE],
      [-100, BASE],
      [0.7, BASE],
      [Infinity, BASE],
      [3, NaN],
      [3, 0],
      [3, -5],
      [3, Infinity],
      [NaN, NaN],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ];
    for (const [failures, base] of degenerate) {
      const delay = nextDelayMs(failures, base);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(HEALTH_POLL_MAX_DELAY_MS);
    }
    expect(nextDelayMs(NaN, NaN)).toBe(60_000);
    expect(nextDelayMs(-3, BASE)).toBe(60_000);
  });
});

describe('P178 · startHealthPoll backs off on failure', () => {
  let doc: EventTarget;
  let handle: HealthPollHandle | null;
  let snapshots: HealthSnapshot[];

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new EventTarget();
    setHidden(doc, false);
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('backend down');
      }),
    );
    handle = null;
    snapshots = [];
  });

  afterEach(() => {
    handle?.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as { document?: unknown }).document;
    vi.useRealTimers();
  });

  const start = () => {
    handle = startHealthPoll(BASE, (s) => snapshots.push(s));
    return handle;
  };

  it('doubles the gap after each failed poll, caps at 5 min, resets after one success', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1); // initial poll fails -> n=1, next tick +120s
    expect(snapshots.at(-1)?.reachable).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000); // t=60s: backed off, no poll yet
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); // t=120s: poll #2 fails -> n=2, next +240s
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(120_000); // t=240s: still waiting
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000); // t=360s: poll #3 fails -> n=3, next +300s (cap)
    expect(fetch).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(240_000); // t=600s: cap not reached yet
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); // t=660s: poll #4 fails -> stays capped
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(snapshots.at(-1)?.reachable).toBe(false);

    vi.mocked(fetch).mockImplementation(async () => okResponse());
    await vi.advanceTimersByTimeAsync(300_000); // t=960s: poll #5 succeeds -> n=0, next +60s
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(snapshots.at(-1)?.reachable).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000); // t=1020s: back on the base cadence
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('keeps the 60s cadence while every poll succeeds', async () => {
    vi.mocked(fetch).mockImplementation(async () => okResponse());
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('still skips backed-off ticks while the tab is hidden', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    setHidden(doc, true);
    await vi.advanceTimersByTimeAsync(300_000 * 3); // ticks fire but polls are skipped
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stop() clears the pending backoff timer and the listener', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    handle?.stop();
    handle = null;
    expect(vi.getTimerCount()).toBe(0);

    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(300_000 * 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('P178 · source-level guard', () => {
  it('useHealthPoll no longer schedules with setInterval', () => {
    const source = readFileSync(join(SRC, 'hooks', 'useHealthPoll.ts'), 'utf8');
    expect(source).not.toContain('setInterval(');
    expect(source).toContain('setTimeout(');
    expect(source).toContain('nextDelayMs(consecutiveFailures, intervalMs)');
  });
});
