/**
 * P07 — client-side view of the per-IP chat request budget. The backend emits
 * `X-RateLimit-Limit` / `X-RateLimit-Remaining` on every /api/chat* response
 * (see backend/src/lib/guardrails.ts); these helpers parse that pair into a
 * display value and decide when it is low enough to warn. Pure, no React.
 */

export interface RateLimitBudget {
  /** Requests left in the current window. */
  remaining: number;
  /** Window size reported by the server. */
  limit: number;
  /**
   * Seconds until the window reopens, from the `Retry-After` header. Only
   * present on a 429, when the budget is already exhausted.
   */
  retryAfterSec?: number;
  /**
   * Millisecond timestamp (Date.now) of the response this budget was parsed
   * from. P421: without it the chip is a snapshot that can never expire —
   * the 「约 N 秒」 number and the low-budget warning outlive the minute
   * window they describe.
   */
  observedAt: number;
}

/**
 * Structural subset of `Headers` (and of a test shim) — anything with a
 * case-insensitive `get` works. Real `Headers` objects satisfy this directly.
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/** At or below this many remaining requests the indicator turns warning colour. */
export const RATE_LIMIT_WARN_THRESHOLD = 5;
/** At or above this many remaining requests nothing is shown at all. */
export const RATE_LIMIT_HIDE_THRESHOLD = 10;

function parseCount(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Reads the rate-limit pair from response headers. Returns null when either
 * header is missing or not a non-negative integer — callers keep whatever
 * budget they already knew rather than showing a fabricated value.
 */
export function parseRateLimit(
  headers: HeaderReader | null | undefined,
  now: number = Date.now(),
): RateLimitBudget | null {
  if (!headers) return null;
  const remaining = parseCount(headers.get('x-ratelimit-remaining'));
  const limit = parseCount(headers.get('x-ratelimit-limit'));
  if (remaining === null || limit === null || limit === 0) return null;
  // Retry-After is optional (only sent on 429) — a garbage value is ignored
  // rather than sinking the whole budget.
  const retryAfter = parseCount(headers.get('retry-after'));
  return retryAfter === null
    ? { remaining, limit, observedAt: now }
    : { remaining, limit, retryAfterSec: retryAfter, observedAt: now };
}

/** True when at most RATE_LIMIT_WARN_THRESHOLD requests remain. */
export function rateLimitWarning(budget: RateLimitBudget): boolean {
  return budget.remaining <= RATE_LIMIT_WARN_THRESHOLD;
}

/**
 * P421 — seconds until the window this budget describes reopens, rounded up.
 * An exhausted budget lives for `retryAfterSec ?? 60` seconds from
 * `observedAt`; any other budget describes a fixed 60 s server window. Once
 * the window has passed the answer is 0 — the stale 「约 N 秒」 number must
 * never be shown again.
 */
export function rateLimitSecondsLeft(budget: RateLimitBudget, now: number): number {
  const windowMs =
    budget.remaining === 0 ? (budget.retryAfterSec ?? 60) * 1000 : 60_000;
  const leftMs = budget.observedAt + windowMs - now;
  return leftMs <= 0 ? 0 : Math.ceil(leftMs / 1000);
}

/**
 * P421 — the budget while its window is still live, `null` once it has
 * expired. Renderers should route the stored snapshot through this so an
 * old minute's numbers can never linger on screen.
 */
export function effectiveBudget(
  budget: RateLimitBudget,
  now: number,
): RateLimitBudget | null {
  return rateLimitSecondsLeft(budget, now) > 0 ? budget : null;
}

/**
 * P422 — should the 1 s heartbeat that drives the live countdown be running
 * at all? True only while a hint could actually be on screen: a budget is
 * known, its window is still live, and it sits below the hide threshold. A
 * comfortable or expired budget renders nothing, so every tick would be a
 * wasted re-render for the rest of the page's life.
 */
export function rateLimitTickerActive(
  budget: RateLimitBudget | null,
  now: number,
): boolean {
  return (
    budget !== null &&
    effectiveBudget(budget, now) !== null &&
    budget.remaining < RATE_LIMIT_HIDE_THRESHOLD
  );
}

/**
 * P256 — the countdown meter only created run-out anxiety about a budget
 * that resets every minute. Nothing renders while the minute is comfortable
 * (≥ RATE_LIMIT_HIDE_THRESHOLD left — nearly every turn, the clean landing
 * screen, and every post-refresh state where the budget is simply unknown).
 * Below that the hint is one human sentence, and an exhausted window states
 * the real recovery time instead of a bare count. Returns null whenever
 * nothing should be shown.
 *
 * P421: the exhausted copy is built from `rateLimitSecondsLeft(budget, now)`
 * so it counts down live, and every hint returns null once the window the
 * budget describes has reopened — no fossil numbers, no stale warnings.
 */
export function rateLimitHint(
  budget: RateLimitBudget,
  now: number = Date.now(),
): string | null {
  if (effectiveBudget(budget, now) === null) return null;
  if (budget.remaining >= RATE_LIMIT_HIDE_THRESHOLD) return null;
  if (budget.remaining === 0) {
    if (budget.retryAfterSec !== undefined && budget.retryAfterSec > 0) {
      return `这一分钟到上限了，约 ${rateLimitSecondsLeft(budget, now)} 秒后可以再问`;
    }
    return '这一分钟到上限了，稍等一下再问';
  }
  return '这一分钟快到上限了，稍等几秒再问';
}
