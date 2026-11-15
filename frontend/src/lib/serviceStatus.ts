/**
 * P11 — decides whether a failed chat request means the service itself is
 * down (worth a top banner + retry affordance) versus a request-level problem
 * that stays an inline error on the bubble. A network/transport failure or
 * any HTTP 5xx counts as an outage; 400/413/429 and successes do not — those
 * are surfaced by the existing inline error + Retry-After handling. Pure.
 */
export function isServiceDown(input: { networkError?: boolean; status?: number }): boolean {
  if (input.networkError) return true;
  return typeof input.status === 'number' && input.status >= 500;
}
