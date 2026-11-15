import { useEffect, useState } from 'react';
import { coarseStatus, type HealthSnapshot } from '../lib/healthStatus';

/** P27 — the footer re-checks /api/health once a minute. */
export const HEALTH_POLL_INTERVAL_MS = 60_000;

export interface HealthPollHandle {
  stop: () => void;
}

const INITIAL_SNAPSHOT: HealthSnapshot = {
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
};

/**
 * P135 — polls /api/health immediately and every `intervalMs`, but only while
 * the tab is visible: interval ticks are skipped while `document.hidden`, no
 * initial poll fires when mounted in a background tab, and becoming visible
 * again triggers one immediate poll so the footer is fresh. A failed poll
 * keeps the last known status (the footer still warns via `reachable`), so a
 * single dropped request does not rewrite the history shown in the tooltip.
 */
export function startHealthPoll(
  intervalMs: number,
  onSnapshot: (snapshot: HealthSnapshot) => void,
): HealthPollHandle {
  let cancelled = false;
  let snapshot = INITIAL_SNAPSHOT;

  const poll = async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload: unknown = await res.json();
      if (!cancelled) {
        snapshot = {
          status: coarseStatus(payload),
          reachable: true,
          lastCheckedAt: Date.now(),
        };
        onSnapshot(snapshot);
      }
    } catch {
      if (!cancelled) {
        snapshot = { ...snapshot, reachable: false, lastCheckedAt: Date.now() };
        onSnapshot(snapshot);
      }
    }
  };

  const onVisibilityChange = () => {
    if (!document.hidden) {
      void poll();
    }
  };

  if (!document.hidden) {
    void poll();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  const timer = setInterval(() => {
    if (!document.hidden) {
      void poll();
    }
  }, intervalMs);

  return {
    stop() {
      cancelled = true;
      clearInterval(timer);
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
