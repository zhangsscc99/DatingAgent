import { useEffect, useState } from 'react';
import { coarseStatus, type HealthSnapshot } from '../lib/healthStatus';

/** P27 — the footer re-checks /api/health once a minute. */
export const HEALTH_POLL_INTERVAL_MS = 60_000;

/** P178 — failure backoff never waits longer than five minutes. */
export const HEALTH_POLL_MAX_DELAY_MS = 5 * 60_000;

/**
 * P178 — pure scheduling rule for the health poll. With no failures the poll
 * runs every `baseIntervalMs`; each consecutive failure doubles the wait
 * (`base * 2^n`) up to `HEALTH_POLL_MAX_DELAY_MS`, and one success resets the
 * counter to 0. Degenerate inputs clamp to a sane positive delay so callers
 * can never schedule a NaN/Infinity/0ms timer.
 */
export function nextDelayMs(consecutiveFailures: number, baseIntervalMs: number): number {
  const base =
    Number.isFinite(baseIntervalMs) && baseIntervalMs > 0
      ? baseIntervalMs
      : HEALTH_POLL_INTERVAL_MS;
  const n =
    Number.isFinite(consecutiveFailures) && consecutiveFailures > 0
      ? Math.floor(consecutiveFailures)
      : 0;
  const delay = base * 2 ** n;
  return Number.isFinite(delay) && delay <= HEALTH_POLL_MAX_DELAY_MS
    ? delay
    : HEALTH_POLL_MAX_DELAY_MS;
}

export interface HealthPollHandle {
  stop: () => void;
}

const INITIAL_SNAPSHOT: HealthSnapshot = {
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
};

/**
 * P420 — read the body of a non-2xx /api/health response. Returns the
 * payload's `degradedReason` ('llm' | 'frontend-dist' | null) only when the
 * body parses to an object with `status === 'degraded'`; otherwise throws so
 * the caller falls back to ordinary failure semantics.
 */
async function readDegradedReason(
  res: Response,
): Promise<'llm' | 'frontend-dist' | null> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { status?: unknown }).status === 'degraded'
  ) {
    const reason = (body as { degradedReason?: unknown }).degradedReason;
    return reason === 'llm' || reason === 'frontend-dist' ? reason : null;
  }
  throw new Error(`HTTP ${res.status}`);
}

/**
 * P135 — polls /api/health immediately and on a recurring timer, but only
 * while the tab is visible: ticks are skipped while `document.hidden`, no
 * initial poll fires when mounted in a background tab, and becoming visible
 * again triggers one immediate poll so the footer is fresh. A failed poll
 * keeps the last known status (the footer still warns via `reachable`), so a
 * single dropped request does not rewrite the history shown in the tooltip.
 *
 * P178 — the recurring timer is a self-rescheduling `setTimeout` whose delay
 * comes from `nextDelayMs`: consecutive failures double the wait up to five
 * minutes, and one success drops straight back to `intervalMs`.
 */
export function startHealthPoll(
  intervalMs: number,
  onSnapshot: (snapshot: HealthSnapshot) => void,
): HealthPollHandle {
  let cancelled = false;
  let snapshot = INITIAL_SNAPSHOT;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!cancelled) {
      timer = setTimeout(() => void tick(), nextDelayMs(consecutiveFailures, intervalMs));
    }
  };

  const poll = async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        // P420 — a non-2xx that still carries the health JSON is a
        // degraded-but-alive server, not a network outage: it counts as
        // reachable and resets the backoff. Anything else (HTML gateway
        // page, unreadable body) throws into the failure branch below.
        const degradedReason = await readDegradedReason(res);
        if (!cancelled) {
          consecutiveFailures = 0;
          snapshot = {
            status: 'degraded',
            reachable: true,
            degradedReason,
            lastCheckedAt: Date.now(),
          };
          onSnapshot(snapshot);
        }
      } else {
        const payload: unknown = await res.json();
        if (!cancelled) {
          consecutiveFailures = 0;
          snapshot = {
            status: coarseStatus(payload),
            reachable: true,
            lastCheckedAt: Date.now(),
          };
          onSnapshot(snapshot);
        }
      }
    } catch {
      if (!cancelled) {
        consecutiveFailures += 1;
        snapshot = { ...snapshot, reachable: false, lastCheckedAt: Date.now() };
        onSnapshot(snapshot);
      }
    }
    schedule();
  };

  const tick = async () => {
    if (!document.hidden) {
      await poll();
    } else {
      schedule();
    }
  };

  const onVisibilityChange = () => {
    if (!document.hidden) {
      void poll();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  void tick();

  return {
    stop() {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

export function useHealthPoll(intervalMs = HEALTH_POLL_INTERVAL_MS): HealthSnapshot {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    const handle = startHealthPoll(intervalMs, setSnapshot);
    return () => handle.stop();
  }, [intervalMs]);

  return snapshot;
}
