import type { IncomingHttpHeaders } from 'node:http';

/**
 * P170 — same-origin CORS policy. The bare `cors()` middleware answered every
 * response with `Access-Control-Allow-Origin: *`, so any third-party page a
 * user opened could drive the chat API from their browser and burn LLM quota.
 * The policy now reflects the request Origin only when it matches the host the
 * request arrived on (Host, or X-Forwarded-Host behind a proxy); anything else
 * gets no Access-Control-* headers at all.
 */

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** First entry of a possibly list-valued HTTP header ("a, b" or ['a', 'b']). */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first || undefined;
}

/** Host[:port] the request targets, preferring X-Forwarded-Host when present. */
export function requestHost(headers: IncomingHttpHeaders): string | undefined {
  return (
    firstHeaderValue(headers['x-forwarded-host']) ?? firstHeaderValue(headers['host'])
  );
}

/**
 * True when `origin` points at the same host[:port] the request arrived on.
 * `host` is the Host or X-Forwarded-Host value and may carry a port; parsing it
 * under the origin's scheme normalises default ports, so `https://example.com`
 * matches `example.com` and `example.com:443`, while `example.com:8080` does not.
 */
export function isSameOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin || !host) return false;
  const originUrl = parseUrl(origin);
  if (!originUrl) return false;
  const hostUrl = parseUrl(`${originUrl.protocol}//${host}`);
  return hostUrl !== undefined && hostUrl.host === originUrl.host;
}

/**
 * A request with no Origin header is a non-browser client (curl) or a
 * same-origin fetch that omitted it — allowed, though there is nothing to
 * reflect. Otherwise the Origin's host must match the request host.
 */
export function isCorsAllowed(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  return !origin || isSameOrigin(origin, host);
}
