import { useEffect, useState } from 'react';
import { coarseStatus, type HealthSnapshot } from '../lib/healthStatus';

/** P27 — the footer re-checks /api/health once a minute. */
export const HEALTH_POLL_INTERVAL_MS = 60_000;

/**
 * Polls /api/health immediately and every `intervalMs`. A failed poll keeps the
 * last known status (the footer still warns via `reachable`), so a single
 * dropped request does not rewrite the history shown in the tooltip.
 */
export function useHealthPoll(intervalMs = HEALTH_POLL_INTERVAL_MS): HealthSnapshot {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>({
    status: 'unknown',
    reachable: true,
    lastCheckedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload: unknown = await res.json();
        if (!cancelled) {
          setSnapshot({
            status: coarseStatus(payload),
            reachable: true,
            lastCheckedAt: Date.now(),
          });
        }
      } catch {
        if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, reachable: false, lastCheckedAt: Date.now() }));
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return snapshot;
}
