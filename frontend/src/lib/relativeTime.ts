/**
 * P63 — shared relative-time / latency formatting.
 * Single source of truth for the session dropdown's "N 分钟前" labels and
 * the reply meta badge's "1.2s" latency text. Pure module, no React.
 */

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
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
