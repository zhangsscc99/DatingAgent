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
 * P291 — the visible footer label is plain language; internal words like
 * 运行正常 / 服务降级 / level names never reach the screen.
 */
export function statusLabel(snapshot: HealthSnapshot): string {
  if (footerLevel(snapshot) === 'pending') return '检测中…';
  if (!snapshot.reachable) return '暂时连不上，稍等再试';
  return snapshot.status === 'ok' ? '● 在线' : '● 有点忙，稍等';
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
