import { isRenderableTimestamp } from './relativeTime';

/**
 * P329 — absolute-time formatting for the reply meta row and the recycle
 * bin's days-left counter. The relative labels (「3 分钟前」) never tell the
 * reader which morning a reply landed or how close a trashed conversation
 * is to eviction, so the exact values ride alongside: the bubble keeps its
 * relative text inside a <time dateTime title> (hover/long-press reveals
 * the absolute stamp, zero layout change) and each trash row appends its
 * own 「· 剩 N 天」 instead of relying on the one-size retention note.
 * Pure module, no React.
 */

const DAY_MS = 86_400_000;

/** Local-time label: same year 「11月18日 16:52」, a different year carries
 * the year 「2025年12月3日 09:05」. Anything isRenderableTimestamp rejects
 * (NaN, 0/negative, far future, non-number) returns '' so the caller can
 * skip emitting the title attribute entirely — never title="". */
export function formatAbsolute(
  ts: unknown,
  now: number = Date.now(),
): string {
  if (!isRenderableTimestamp(ts, now)) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const mdhm = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? mdhm
    : `${d.getFullYear()}年${mdhm}`;
}

/** Days of trash retention left, rounded up — an entry with any fraction
 * of a day remaining still reads 「剩 1 天」, and an expired one clamps to 0
 * rather than going negative. */
export function trashDaysLeft(
  deletedAt: number,
  now: number,
  ttlMs: number,
): number {
  const remainingMs = deletedAt + ttlMs - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}
