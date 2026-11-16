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
/** Above this many remaining requests the indicator drops to a dim style. */
export const RATE_LIMIT_DIM_THRESHOLD = 10;

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
): RateLimitBudget | null {
  if (!headers) return null;
  const remaining = parseCount(headers.get('x-ratelimit-remaining'));
  const limit = parseCount(headers.get('x-ratelimit-limit'));
  if (remaining === null || limit === null || limit === 0) return null;
  // Retry-After is optional (only sent on 429) — a garbage value is ignored
  // rather than sinking the whole budget.
  const retryAfter = parseCount(headers.get('retry-after'));
  return retryAfter === null
    ? { remaining, limit }
    : { remaining, limit, retryAfterSec: retryAfter };
}

/** True when at most RATE_LIMIT_WARN_THRESHOLD requests remain. */
export function rateLimitWarning(budget: RateLimitBudget): boolean {
  return budget.remaining <= RATE_LIMIT_WARN_THRESHOLD;
}

/** True when the budget is comfortable enough to stay out of the way. */
export function rateLimitDim(budget: RateLimitBudget): boolean {
  return budget.remaining > RATE_LIMIT_DIM_THRESHOLD && !rateLimitWarning(budget);
}

/**
 * Self-explanatory chip copy — names the window and the unit, and shows the
 * countdown while a Retry-After window is active. e.g. `本分钟还可提问 27 次`,
 * `本分钟额度已用完，45 秒后可再问`.
 */
export function formatRateLimit(budget: RateLimitBudget): string {
  if (
    budget.remaining === 0 &&
    budget.retryAfterSec !== undefined &&
    budget.retryAfterSec > 0
  ) {
    return `本分钟额度已用完，${budget.retryAfterSec} 秒后可再问`;
  }
  return `本分钟还可提问 ${budget.remaining} 次`;
}
