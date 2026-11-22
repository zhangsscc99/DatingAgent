import { useEffect, useState } from 'react';

/** P442 — minute cadence that keeps relative-time labels advancing. */
export const TIME_TICKER_INTERVAL_MS = 60_000;

export interface TimeTickerHandle {
  stop: () => void;
}

/**
 * P442 — non-React core of useTimeTicker: calls `onTick(Date.now())` every
 * `intervalMs` while the tab is visible. Ticks are skipped while
 * `document.hidden` (the labels are off screen anyway), and one immediate
 * tick fires the moment the tab becomes visible again so a returning user
 * never stares at a stale 「刚刚」. A missing `document` is treated as
 * visible-without-events; without `setInterval` the ticker is a no-op and
 * callers keep their mount-time snapshot.
 */
export function startTimeTicker(
  intervalMs: number,
  onTick: (now: number) => void,
): TimeTickerHandle {
  if (typeof setInterval !== 'function') {
    return { stop() {} };
  }
  const ms =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : TIME_TICKER_INTERVAL_MS;
  const isHidden = () =>
    typeof document !== 'undefined' && document.hidden === true;
  const id = setInterval(() => {
    if (!isHidden()) onTick(Date.now());
  }, ms);
  const onVisibilityChange = () => {
    if (!isHidden()) onTick(Date.now());
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return {
    stop() {
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}

/**
 * P442 — a `now` timestamp that re-renders every `intervalMs` so
 * formatRelativeTime labels in bubbles, the sidebar and the trash sheet
 * age on their own clock instead of freezing at whatever render happened
 * to paint them. Paused in a hidden tab, refreshed instantly on return;
 * where timers or `document` are unavailable the mount-time value stands.
 */
export function useTimeTicker(intervalMs = TIME_TICKER_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = startTimeTicker(intervalMs, setNow);
    return () => handle.stop();
  }, [intervalMs]);
  return now;
}
