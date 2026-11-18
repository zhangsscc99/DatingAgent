/**
 * P27 — coarse /api/health status for the system-status footer. Only the
 * `status` field is ever read; the rest of the payload (model name, metrics,
 * env details) is deliberately ignored so nothing sensitive reaches the DOM.
 */

export type CoarseStatus = 'ok' | 'degraded' | 'unknown';

export interface HealthSnapshot {
  /** Status from the last successful payload; 'unknown' until the first poll. */
  status: CoarseStatus;
  /** Whether the most recent poll attempt reached the server. */
  reachable: boolean;
  /** Epoch millis of the last completed poll attempt; null before the first. */
  lastCheckedAt: number | null;
}

/** Reduce a raw /api/health payload to 'ok' | 'degraded'; anything odd → 'degraded'. */
export function coarseStatus(payload: unknown): 'ok' | 'degraded' {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { status?: unknown }).status === 'ok'
  ) {
    return 'ok';
  }
  return 'degraded';
}

export type FooterLevel = 'ok' | 'warn' | 'pending';

export function footerLevel(snapshot: HealthSnapshot): FooterLevel {
  if (snapshot.lastCheckedAt === null) return 'pending';
  if (!snapshot.reachable || snapshot.status !== 'ok') return 'warn';
  return 'ok';
}

/**
 * P291 — internal words like 运行正常 / 服务降级 / level names never reach the
 * screen. P297 — the footer only speaks when something is wrong: a healthy or
 * still-pending snapshot yields `null` so nothing renders at all, and a
 * warning is phrased in plain language.
 */
export function statusLabel(snapshot: HealthSnapshot): string | null {
  if (footerLevel(snapshot) !== 'warn') return null;
  if (!snapshot.reachable) return '连接有点问题，正在重试';
  return '服务有点忙，稍等再试';
}

/**
 * P291 — technical detail for the footer's title/aria-label only: the raw
 * level/status words are allowed here because they are not the visible label.
 */
export function statusDetail(snapshot: HealthSnapshot): string {
  const state =
    snapshot.lastCheckedAt === null
      ? 'pending'
      : !snapshot.reachable
        ? 'unreachable'
        : snapshot.status;
  const checked = snapshot.lastCheckedAt
    ? `上次检测 ${new Date(snapshot.lastCheckedAt).toLocaleTimeString('zh-CN')}`
    : '尚未检测';
  return `level: ${footerLevel(snapshot)}，status: ${state}，${checked}`;
}
