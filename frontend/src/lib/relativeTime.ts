/**
 * P63 — shared relative-time / latency formatting.
 * Single source of truth for the session dropdown's "N 分钟前" labels and
 * the reply meta badge's "1.2s" latency text. Pure module, no React.
 */

/** P186: a persisted timestamp is renderable only as a finite, positive
 * number no more than a day in the future (clock-skew tolerance). NaN,
 * Infinity, 0/negative, non-numbers and far-future values are corrupt data —
 * 0 used to render as "20773 天前" (epoch 1970). */
export const MAX_TIMESTAMP_FUTURE_SKEW_MS = 86_400_000;

export function isRenderableTimestamp(
  ts: unknown,
  now: number = Date.now(),
): ts is number {
  return (
    typeof ts === 'number' &&
    Number.isFinite(ts) &&
    ts > 0 &&
    ts <= now + MAX_TIMESTAMP_FUTURE_SKEW_MS
  );
}

export function formatRelativeTime(ts: unknown, now: number = Date.now()): string {
  if (!isRenderableTimestamp(ts, now)) return '时间未知';
  const diff = now - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
}

export function formatLatencySeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
