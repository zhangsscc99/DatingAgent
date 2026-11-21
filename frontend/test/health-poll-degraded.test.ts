/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHealthPoll,
  type HealthPollHandle,
} from '../src/hooks/useHealthPoll';
import { statusLabel, type HealthSnapshot } from '../src/lib/healthStatus';

/**
 * P420 — P419 made /api/health answer 503 + a full JSON body
 * (`{"status":"degraded","degradedReason":"llm"|"frontend-dist",…}`) when the
 * server is alive but degraded. The poller used to throw on every non-2xx,
 * so a reachable server was reported as a network outage and the poll backed
 * off to five minutes. Now a 503 carrying the health payload counts as
 * reachable degraded copy with no backoff; only a non-health body (gateway
 * HTML page, unreadable JSON) keeps the failure semantics. Same node-env DOM
 * stub + fake timers style as health-poll-backoff.test.ts.
 */

const BASE = 60_000;

const setHidden = (doc: EventTarget, hidden: boolean) => {
  Object.defineProperty(doc, 'hidden', { value: hidden, configurable: true });
};

const degradedResponse = (degradedReason: 'llm' | 'frontend-dist') =>
  ({
    ok: false,
    status: 503,
    json: async () => ({ status: 'degraded', degradedReason }),
  }) as Response;

const htmlErrorResponse = () =>
  ({
    ok: false,
    status: 503,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  }) as Response;

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  }) as Response;

const snap = (patch: Partial<HealthSnapshot>): HealthSnapshot => ({
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
  ...patch,
});

describe('P420 · a 503 carrying the health JSON is reachable-degraded, not an outage', () => {
  let doc: EventTarget;
  let handle: HealthPollHandle | null;
  let snapshots: HealthSnapshot[];

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new EventTarget();
    setHidden(doc, false);
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
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

  it('503 + degraded JSON → reachable degraded snapshot, next tick stays at the 60s base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => degradedResponse('llm')));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    const s = snapshots.at(-1);
    expect(s?.reachable).toBe(true);
    expect(s?.status).toBe('degraded');
    expect(s?.degradedReason).toBe('llm');

    // consecutiveFailures was reset to 0: the next poll is due at +60s,
    // not the +120s a real failure would schedule.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a degraded body without a usable reason still reads as reachable degraded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            json: async () => ({ status: 'degraded' }),
          }) as Response,
      ),
    );
    start();
    await vi.advanceTimersByTimeAsync(0);
    const s = snapshots.at(-1);
    expect(s?.reachable).toBe(true);
    expect(s?.status).toBe('degraded');
    expect(s?.degradedReason).toBeNull();
  });

  it('503 whose body is not JSON (gateway error page) still counts as a failure and backs off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlErrorResponse()));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.reachable).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000); // backed off: no poll at +60s
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); // poll #2 at +120s
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.reachable).toBe(false);
  });

  it('a 503 carrying a non-degraded JSON body still counts as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            json: async () => ({ status: 'ok' }),
          }) as Response,
      ),
    );
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots.at(-1)?.reachable).toBe(false);
  });

  it('200 {status:ok} is unchanged: reachable ok snapshot on the base cadence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
    start();
    await vi.advanceTimersByTimeAsync(0);
    const s = snapshots.at(-1);
    expect(s?.reachable).toBe(true);
    expect(s?.status).toBe('ok');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('P420 · statusLabel speaks the degraded reason in plain words', () => {
  const INTERNAL = /ok|degraded|timeout|health/i;

  it('maps each degradedReason to honest, internal-word-free copy', () => {
    const llm = statusLabel(
      snap({ status: 'degraded', degradedReason: 'llm', lastCheckedAt: 1 }),
    );
    expect(llm).toBe('回答功能还没就绪，稍后再试');

    const dist = statusLabel(
      snap({ status: 'degraded', degradedReason: 'frontend-dist', lastCheckedAt: 1 }),
    );
    expect(dist).toBe('界面文件还在更新，刷新试试');

    const other = statusLabel(
      snap({ status: 'degraded', degradedReason: null, lastCheckedAt: 1 }),
    );
    expect(other).toBe('服务有点忙，稍等再试');
    expect(
      statusLabel(snap({ status: 'degraded', lastCheckedAt: 1 })),
    ).toBe('服务有点忙，稍等再试');

    for (const label of [llm, dist, other]) {
      expect(label).not.toBeNull();
      expect(label!).not.toMatch(INTERNAL);
      expect(label!).not.toContain('服务降级');
      expect(label!).not.toContain('运行正常');
    }
  });

  it('still says 连接有点问题，正在重试 when the server is unreachable', () => {
    expect(
      statusLabel(snap({ status: 'ok', reachable: false, lastCheckedAt: 1 })),
    ).toBe('连接有点问题，正在重试');
    // A stale degradedReason never overrides the unreachable wording.
    expect(
      statusLabel(
        snap({
          status: 'degraded',
          degradedReason: 'llm',
          reachable: false,
          lastCheckedAt: 1,
        }),
      ),
    ).toBe('连接有点问题，正在重试');
  });
});
