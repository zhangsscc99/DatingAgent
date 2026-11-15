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
}

/**
 * Structural subset of `Headers` (and of a test shim) — anything with a
 * case-insensitive `get` works. Real `Headers` objects satisfy this directly.
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Below this many remaining requests the indicator turns warning colour. */
export const RATE_LIMIT_WARN_THRESHOLD = 5;

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
  return { remaining, limit };
}

/** True when fewer than RATE_LIMIT_WARN_THRESHOLD requests remain. */
export function rateLimitWarning(budget: RateLimitBudget): boolean {
  return budget.remaining < RATE_LIMIT_WARN_THRESHOLD;
}

/** e.g. `剩余请求 27/30` */
export function formatRateLimit(budget: RateLimitBudget): string {
  return `剩余请求 ${budget.remaining}/${budget.limit}`;
}
