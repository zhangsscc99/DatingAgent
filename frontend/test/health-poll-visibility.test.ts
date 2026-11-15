/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHealthPoll, type HealthPollHandle } from '../src/hooks/useHealthPoll';
import type { HealthSnapshot } from '../src/lib/healthStatus';

/**
 * P135 — the P27 health poll must not burn requests in a background tab.
 * Vitest runs in node (no DOM), so `document` is replaced with a bare
 * EventTarget whose `hidden` flag the test flips via Object.defineProperty;
 * `visibilitychange` is driven by dispatching a real Event. No real network,
 * no real timers.
 */

const setHidden = (doc: EventTarget, hidden: boolean) => {
  Object.defineProperty(doc, 'hidden', { value: hidden, configurable: true });
};

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  }) as Response;

describe('P135 · health poll pauses while hidden', () => {
  let doc: EventTarget;
  let handle: HealthPollHandle | null;
  let snapshots: HealthSnapshot[];

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new EventTarget();
    setHidden(doc, false);
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
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
    handle = startHealthPoll(60_000, (s) => snapshots.push(s));
    return handle;
  };

  it('fires no fetch at mount and skips interval ticks while hidden', async () => {
    setHidden(doc, true);
    start();
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(fetch).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(0);
  });

  it('polls exactly once when the document becomes visible, then resumes the cadence', async () => {
    setHidden(doc, true);
    start();
    setHidden(doc, false);
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.reachable).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);

    setHidden(doc, true);
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not poll on visibilitychange while still hidden', async () => {
    setHidden(doc, true);
    start();
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves no fetches or timers behind after stop()', async () => {
    setHidden(doc, false);
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    handle?.stop();
    handle = null;
    expect(vi.getTimerCount()).toBe(0);

    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
