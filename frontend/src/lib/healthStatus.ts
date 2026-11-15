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

export function statusLabel(snapshot: HealthSnapshot): string {
  if (footerLevel(snapshot) === 'pending') return '检测中…';
  if (!snapshot.reachable) return '无法连接';
  return snapshot.status === 'ok' ? '运行正常' : '服务降级';
}
