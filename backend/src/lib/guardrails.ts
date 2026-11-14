import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Longest chat message the API accepts, in characters. Mirrored in the frontend input. */
export const MAX_MESSAGE_CHARS = 4000;
/** Per-IP request budget for the chat endpoints. */
export const RATE_LIMIT_MAX = 30;
/** Length of the rate-limit window. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimitOptions {
  max?: number;
  windowMs?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Best-effort client identity. Falls back to the socket address when `req.ip` is unset. */
function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Fixed-window per-IP rate limiter.
 * Over budget → 429 with `Retry-After` (seconds) plus `X-RateLimit-*` headers.
 */
export function createRateLimiter(options: RateLimitOptions = {}): RequestHandler {
  const max = options.max ?? RATE_LIMIT_MAX;
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      // Opportunistic sweep so the map cannot grow without bound under IP churn.
      if (buckets.size > 1000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
      res.status(429).json({
        error: `Too many requests — retry in ${retryAfter}s`,
        retryAfter,
      });
      return;
    }

    next();
  };
}

/** Rejects chat payloads whose `message` exceeds `MAX_MESSAGE_CHARS` with a JSON 413. */
export function rejectOversizedMessage(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as { message?: unknown } | undefined;
  const message = body?.message;

  if (typeof message === 'string' && message.length > MAX_MESSAGE_CHARS) {
    res.status(413).json({
      error: `Message too long: ${message.length} characters (max ${MAX_MESSAGE_CHARS})`,
      maxChars: MAX_MESSAGE_CHARS,
    });
    return;
  }

  next();
}

/**
 * Turns body-parser failures into the API's JSON error shape instead of an HTML page.
 * Must be registered after `express.json()` so the parser's errors reach it.
 */
export function handleBodyErrors(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const type = (err as { type?: string } | null)?.type;

  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }

  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  next(err);
}
