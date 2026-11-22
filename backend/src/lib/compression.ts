import zlib from 'node:zlib';
import type { Request, RequestHandler, Response } from 'express';

/** Bodies below this size cost more in gzip overhead than they save. */
const MIN_COMPRESS_BYTES = 1024;

/**
 * Text-family payloads worth compressing: all `text/*` except SSE (buffering
 * would destroy its first-byte latency), plus the JS/JSON/SVG types that
 * express.static and res.json emit.
 */
function isCompressibleType(contentType: unknown): boolean {
  if (typeof contentType !== 'string' && typeof contentType !== 'number') return false;
  const mime = String(contentType).split(';', 1)[0].trim().toLowerCase();
  if (mime === 'text/event-stream') return false;
  if (mime.startsWith('text/')) return true;
  return (
    mime === 'application/javascript' ||
    mime === 'application/json' ||
    mime === 'image/svg+xml'
  );
}

/**
 * `Accept-Encoding` token check — `xgzip` must not match, `gzip;q=0.8` must,
 * `gzip;q=0` must not (RFC 9110: q=0 means "not acceptable"). Each element's
 * q-value comes from the `q=` param after the first `;`, defaulting to 1.
 */
function acceptsGzip(req: Request): boolean {
  const header = req.headers['accept-encoding'];
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  for (const part of value.split(',')) {
    const [token, ...params] = part.split(';');
    if (token.trim().toLowerCase() !== 'gzip') continue;
    let q = 1;
    for (const param of params) {
      const m = /^\s*q\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(param);
      if (m) q = Number(m[1]);
    }
    return q > 0;
  }
  return false;
}

interface EndArgs {
  tail: unknown;
  encoding?: BufferEncoding;
  callback?: () => void;
}

/** res.end's overloads: end(), end(cb), end(chunk, [encoding], [cb]). */
function parseEndArgs(args: unknown[]): EndArgs {
  const [first, second, third] = args;
  if (args.length === 0 || typeof first === 'function') {
    return { tail: undefined, callback: first as (() => void) | undefined };
  }
  return {
    tail: first,
    encoding: typeof second === 'string' ? (second as BufferEncoding) : undefined,
    callback: (typeof second === 'function' ? second : third) as (() => void) | undefined,
  };
}

/**
 * P426 — gzip for text responses ≥ 1 KB using node:zlib only. The body is
 * buffered through res.write/res.end wrappers and compressed once at end;
 * anything that can no longer be rewritten (headers already flushed,
 * res.flush called, a non-text Content-Type seen mid-stream, SSE) switches
 * to pass-through immediately so streaming latency is untouched. Headers
 * the handler set stay verbatim — only Content-Length is recomputed after
 * compression. Partial responses (206 / Content-Range) are never compressed:
 * range offsets address the identity bytes, so gzipping them corrupts resumes.
 * Never throws into the request path: on a gzip failure the
 * original uncompressed bytes are sent.
 */
export function createCompressionMiddleware(): RequestHandler {
  return (req: Request, res: Response, next) => {
    // P431 — a 304 revalidation must still declare which variant it holds.
    // Express strips Content-Type before res.end on a 304, so remember the
    // last declared type via a setHeader hook.
    let lastSeenContentType: unknown;
    const originalSetHeader = res.setHeader.bind(res) as (
      name: string,
      value: unknown,
    ) => Response;
    res.setHeader = function (this: Response, name: string, value: unknown): Response {
      if (name.toLowerCase() === 'content-type') lastSeenContentType = value;
      return originalSetHeader(name, value);
    } as typeof res.setHeader;

    /** Add `Vary: Accept-Encoding` to a compressible 304; touch nothing else. */
    const varyFor304 = (): void => {
      if (res.statusCode !== 304 || res.headersSent) return;
      if (isCompressibleType(res.getHeader('Content-Type') ?? lastSeenContentType)) {
        res.vary('Accept-Encoding');
      }
    };

    if (!acceptsGzip(req)) {
      // Identity-only clients never get a compressed body, but their 304s
      // still need Vary so shared caches can tell the variants apart.
      const end = res.end.bind(res) as unknown as (...args: unknown[]) => Response;
      res.end = function (this: Response, ...args: unknown[]): Response {
        varyFor304();
        return end(...args);
      } as typeof res.end;
      next();
      return;
    }

    const originalWrite = res.write.bind(res) as unknown as (
      chunk: unknown,
      ...rest: unknown[]
    ) => boolean;
    const originalEnd = res.end.bind(res) as unknown as (...args: unknown[]) => Response;
    const chunks: Buffer[] = [];
    /** Once true, every write/end goes straight to the socket. */
    let streaming = false;

    const toBuffer = (chunk: unknown, encoding?: BufferEncoding): Buffer => {
      if (Buffer.isBuffer(chunk)) return chunk;
      if (chunk instanceof Uint8Array) return Buffer.from(chunk);
      return Buffer.from(String(chunk), encoding);
    };

    /** Deliver the buffered bytes raw, then let the socket take over. */
    const bypass = (): void => {
      if (streaming) return;
      streaming = true;
      for (const chunk of chunks.splice(0)) originalWrite(chunk);
    };

    /** True while the response can still be rewritten at end time. */
    const stillBufferable = (): boolean => {
      if (streaming || res.headersSent) return false;
      const type = res.getHeader('Content-Type');
      return type === undefined || isCompressibleType(type);
    };

    res.write = function (this: Response, chunk: unknown, ...rest: unknown[]): boolean {
      if (!stillBufferable()) {
        bypass();
        return originalWrite(chunk, ...rest);
      }
      const callback = rest.find((a): a is (err?: Error) => void => typeof a === 'function');
      const encoding = rest.find((a): a is string => typeof a === 'string') as
        | BufferEncoding
        | undefined;
      chunks.push(toBuffer(chunk, encoding));
      // The bytes are accepted even though they are not on the wire yet —
      // fire the callback asynchronously so piped sources keep flowing.
      if (callback) setImmediate(() => callback());
      return true;
    } as typeof res.write;

    res.end = function (this: Response, ...args: unknown[]): Response {
      varyFor304();
      const { tail, encoding, callback } = parseEndArgs(args);
      if (!stillBufferable()) {
        bypass();
        return originalEnd(...args);
      }
      if (tail !== undefined) chunks.push(toBuffer(tail, encoding));
      const body = Buffer.concat(chunks.splice(0));

      // HEAD carries no body — express.static ends without one — so there is
      // nothing to compress. The headers still mirror the GET a client would
      // have received: when the declared size/type proves that GET would be
      // gzipped, advertise the encoding; the compressed length is unknowable
      // without the bytes, so Content-Length is dropped rather than lied.
      if (req.method === 'HEAD') {
        const size =
          body.length > 0 ? body.length : Number(res.getHeader('Content-Length')) || 0;
        if (
          res.statusCode !== 304 &&
          res.statusCode !== 206 &&
          res.getHeader('Content-Range') === undefined &&
          size >= MIN_COMPRESS_BYTES &&
          res.getHeader('Content-Encoding') === undefined &&
          isCompressibleType(res.getHeader('Content-Type'))
        ) {
          res.setHeader('Content-Encoding', 'gzip');
          res.vary('Accept-Encoding');
          res.removeHeader('Content-Length');
        }
        return callback ? originalEnd(body, callback) : originalEnd(body);
      }

      const compressible =
        res.statusCode !== 304 &&
        res.statusCode !== 206 &&
        res.getHeader('Content-Range') === undefined &&
        body.length >= MIN_COMPRESS_BYTES &&
        res.getHeader('Content-Encoding') === undefined &&
        isCompressibleType(res.getHeader('Content-Type'));

      if (compressible) {
        try {
          const zipped = zlib.gzipSync(body, { level: 6 });
          res.setHeader('Content-Encoding', 'gzip');
          res.vary('Accept-Encoding');
          res.setHeader('Content-Length', String(zipped.length));
          return callback ? originalEnd(zipped, callback) : originalEnd(zipped);
        } catch {
          /* fall through and ship the original uncompressed bytes */
        }
      }
      return callback ? originalEnd(body, callback) : originalEnd(body);
    } as typeof res.end;

    // A mid-response header flush ends any hope of rewriting headers —
    // release the buffered bytes raw and stream from here on.
    const originalFlushHeaders = res.flushHeaders.bind(res);
    res.flushHeaders = function (this: Response) {
      bypass();
      return originalFlushHeaders();
    };

    const resWithFlush = res as Response & { flush?: () => void };
    const originalFlush = resWithFlush.flush;
    if (typeof originalFlush === 'function') {
      resWithFlush.flush = () => {
        bypass();
        originalFlush.call(res);
      };
    }

    next();
  };
}
