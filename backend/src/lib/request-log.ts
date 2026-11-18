import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';

/** One access-log record. Deliberately no message text, headers, IPs or keys. */
export interface RequestLogLine {
  ts: string;
  id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  msgLen: number;
  /** P231: ms from request start to the first SSE event, when measured. */
  firstEventMs?: number;
  /**
   * P300: ms from request start to the first content-bearing event (the
   * user-visible "first character"). Unlike firstEventMs — which fires on
   * the instant `thinking` beat — this tracks real model latency.
   */
  firstTokenMs?: number;
  /** P300: tool calls the turn executed (each costs an extra upstream round trip). */
  toolCalls?: number;
}

/**
 * Path without the query string: query values can carry user input or tokens,
 * and the log must contain neither.
 */
function pathOnly(req: Request): string {
  const raw = req.originalUrl || req.url || '';
  const queryAt = raw.indexOf('?');
  return queryAt === -1 ? raw : raw.slice(0, queryAt);
}

/** Short correlation id, also returned as `X-Request-Id`. */
function newRequestId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * Correlation id for the in-flight request — the same value sent as
 * `X-Request-Id` and logged in the access line. Read from `res.locals`
 * (set by `createRequestLogger`), falling back to the response header.
 */
export function requestId(res: Response): string | undefined {
  const local = res.locals.requestId;
  if (typeof local === 'string') return local;
  const header = res.getHeader('X-Request-Id');
  return typeof header === 'string' ? header : undefined;
}

/**
 * Standard `{error, requestId}` payload for every JSON error response under
 * `/api/*`, so a client-reported failure can be matched to its log entry.
 */
export function errorBody(
  res: Response,
  error: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { error, requestId: requestId(res), ...extra };
}

/** Length of a chat message in characters; 0 for non-chat requests. Never the text. */
function messageLength(req: Request): number {
  const body = req.body as { message?: unknown } | undefined;
  return typeof body?.message === 'string' ? body.message.length : 0;
}

/**
 * Emits one JSON line per request: `{ts, id, method, path, status, ms, msgLen}`.
 * Logs on `close` as well as `finish` so aborted requests are still accounted for,
 * and can never throw into the request path.
 */
export function createRequestLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): RequestHandler {
  return (req, res, next) => {
    const startNs = process.hrtime.bigint();
    const id = newRequestId();
    const path = pathOnly(req);
    let logged = false;

    res.setHeader('X-Request-Id', id);
    res.locals.requestId = id;

    const log = (): void => {
      if (logged) return;
      logged = true;

      const line: RequestLogLine = {
        ts: new Date().toISOString(),
        id,
        method: req.method,
        path,
        status: res.statusCode,
        // One decimal place: sub-millisecond requests still report ms > 0.
        ms: Math.round(Number(process.hrtime.bigint() - startNs) / 100_000) / 10,
        msgLen: messageLength(req),
      };

      // P231: the stream route records when its first SSE event went out so
      // the access log shows time-to-first-byte separately from total ms.
      const firstEventMs = res.locals.firstEventMs;
      if (typeof firstEventMs === 'number') line.firstEventMs = firstEventMs;

      // P300: first content token and executed tool-call count, when the
      // chat routes recorded them — separates model latency from the full
      // request duration and exposes tool-turn double calls.
      const firstTokenMs = res.locals.firstTokenMs;
      if (typeof firstTokenMs === 'number') line.firstTokenMs = firstTokenMs;
      const toolCalls = res.locals.toolCalls;
      if (typeof toolCalls === 'number') line.toolCalls = toolCalls;

      try {
        // JSON.stringify escapes newlines, so a hostile path cannot forge extra lines.
        write(JSON.stringify(line));
      } catch {
        /* logging must never break a request */
      }
    };

    res.on('finish', log);
    res.on('close', log);
    next();
  };
}
