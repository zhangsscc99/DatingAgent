import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHarness, createSession, parseChatIntent, parseReplyLanguage, parseReplyLength } from '../agent/harness.js';
import type { AgentContext, AgentEvent, ChatResult, ReplyLanguage, UserProfile } from '../agent/types.js';
import { buildHealthReport, buildVerboseHealth } from '../lib/health.js';
import { apiErrors } from '../lib/last-error.js';
import { buildVersionReport } from '../lib/version.js';
import { createRequestLogger, errorBody, requestId } from '../lib/request-log.js';
import { usageMetrics } from '../lib/metrics.js';
import { sanitizeMessage } from '../lib/sanitize.js';
import { LLMTimeoutError } from '../llm/client.js';
import { getTool } from '../tools/registry.js';
import {
  createRateLimiter,
  handleBodyErrors,
  MAX_MESSAGE_CHARS,
  rejectOversizedMessage,
} from '../lib/guardrails.js';
import { capHistory, historyLimitsFromEnv } from '../lib/history.js';
import { isCorsAllowed, requestHost } from '../lib/cors.js';
import { parsePreviousReplies } from '../lib/reply-dedupe.js';
import {
  forgetMemoryFact,
  ingestSessionMemory,
  rememberUserMessage,
  sessionMemoryFacts,
} from '../lib/memory-extract.js';
import { SessionStore } from '../lib/session-store.js';
import type { MemoryFact } from '../agent/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harness = new AgentHarness();
const frontendDist = path.resolve(__dirname, '../../../frontend/dist');

/** Idle sessions are dropped after this long without activity. */
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
/** Hard ceiling on concurrent sessions held in memory. */
const MAX_SESSIONS = 500;

interface SessionEntry {
  context: AgentContext;
  lastActiveAt: number;
}

export interface AppOptions {
  llmConfigured?: boolean;
  llmModel?: string;
  /** P300: access-log sink override for tests; defaults to stdout. */
  requestLogWriter?: (line: string) => void;
  /** P314: static root override for tests; defaults to <repo>/frontend/dist. */
  frontendDist?: string;
}

/** Loopback-only guard for localhost admin surfaces (verbose health, metrics reset). */
function isLoopback(req: express.Request): boolean {
  const remote = req.ip ?? req.socket.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

/**
 * P339 — the durable facts a session has accumulated. Extraction runs
 * once per user turn (rememberUserMessage) into a stored, deletable
 * memoryFacts list — no longer re-derived from history per response, so
 * DELETE /api/conversations/:id/memory/:key stays deleted. `items` keeps
 * the P313 string shape for compatibility; `facts` carries the keyed
 * objects the memory-management surface needs.
 */
function sessionMemory(context: AgentContext): {
  count: number;
  items: string[];
  facts: MemoryFact[];
} {
  const facts = sessionMemoryFacts(context);
  return { count: facts.length, items: facts.map((f) => f.text), facts };
}

/**
 * P300 — per-request recorder for the access-log latency fields. The first
 * `delta`/`message` event carrying text is the user-visible first
 * character; `tool_start` events count the extra upstream round trips a
 * tool turn serialises. Both land on `res.locals`, which request-log.ts
 * copies onto the JSON access line (`firstTokenMs`, `toolCalls`).
 */
function createChatLatencyRecorder(res: express.Response, startedAt: number) {
  let firstTokenRecorded = false;
  return {
    onEvent(ev: AgentEvent): void {
      if (!firstTokenRecorded && (ev.type === 'delta' || ev.type === 'message')) {
        const content = (ev.data as { content?: unknown }).content;
        if (typeof content === 'string' && content.length > 0) {
          firstTokenRecorded = true;
          res.locals.firstTokenMs = Date.now() - startedAt;
        }
      }
      if (ev.type === 'tool_start') {
        res.locals.toolCalls = (res.locals.toolCalls ?? 0) + 1;
      }
    },
  };
}

export function createApp(options: AppOptions = {}) {
  const llmConfigured = options.llmConfigured ?? Boolean(process.env.OPENAI_API_KEY?.trim());
  const llmModel = options.llmModel ?? (process.env.LLM_MODEL?.trim() || 'gpt-4o-mini');
  const distDir = options.frontendDist ?? frontendDist;
  const app = express();

  /**
   * P359 — per-instance session cache backed by JSON shards on disk. The
   * Map lives inside createApp on purpose: a second app instance in the
   * same process starts with an empty cache and must rehydrate from the
   * same shards a fresh process would read, so "new instance" is exactly
   * "restart". Every mutation path below ends in save(); every eviction
   * or delete drops the shard too, keeping disk and memory in lockstep.
   */
  const sessions = new Map<string, SessionEntry>();
  const sessionStore = new SessionStore();

  /** Drop sessions that have been idle past the TTL. Cheap: at most MAX_SESSIONS entries. */
  function evictIdleSessions(now = Date.now()): void {
    for (const [id, entry] of sessions) {
      if (now - entry.lastActiveAt > SESSION_IDLE_TTL_MS) {
        sessions.delete(id);
        sessionStore.delete(id);
      }
    }
  }

  /** Keep the store bounded by dropping the least recently active sessions first. */
  function enforceSessionCap(): void {
    if (sessions.size <= MAX_SESSIONS) return;
    const oldestFirst = [...sessions.entries()].sort(
      (a, b) => a[1].lastActiveAt - b[1].lastActiveAt,
    );
    for (const [id] of oldestFirst) {
      if (sessions.size <= MAX_SESSIONS) break;
      sessions.delete(id);
      sessionStore.delete(id);
    }
  }

  /** Persist one entry's current state to its shard (atomic write). */
  function persistEntry(entry: SessionEntry): void {
    sessionStore.save(entry.context, entry.lastActiveAt);
  }

  /** Persist whatever the cache currently holds for this context's id —
   * falls back to a fresh timestamp when the entry is not cached. */
  function persistContext(context: AgentContext): void {
    const entry = sessions.get(context.sessionId);
    sessionStore.save(context, entry?.lastActiveAt ?? Date.now());
  }

  /** Insert or refresh a session, persist it, then trim the store to its cap. */
  function putSession(context: AgentContext, now = Date.now()): void {
    evictIdleSessions(now);
    const entry: SessionEntry = { context, lastActiveAt: now };
    sessions.set(context.sessionId, entry);
    persistEntry(entry);
    enforceSessionCap();
  }

  /**
   * Read a session and mark it active. On a cache miss the shard is loaded
   * lazily — that is the restart path. Returns undefined when missing or
   * expired; an expired shard is dropped like an in-memory eviction.
   */
  function touchSession(id: string | undefined, now = Date.now()): AgentContext | undefined {
    if (!id) return undefined;
    let entry = sessions.get(id);
    if (!entry) {
      const stored = sessionStore.load(id);
      if (!stored) return undefined;
      entry = { context: stored.context, lastActiveAt: stored.lastActiveAt };
      sessions.set(id, entry);
    }
    if (now - entry.lastActiveAt > SESSION_IDLE_TTL_MS) {
      sessions.delete(id);
      sessionStore.delete(id);
      return undefined;
    }
    entry.lastActiveAt = now;
    persistEntry(entry);
    return entry.context;
  }

  /**
   * Resolve the session for one chat turn. A pinned `language` sticks to the
   * session so later turns keep the same reply language without resending it.
   * P253: an unknown but client-issued sessionId is adopted (the same
   * convention /api/session/restore already follows), so the frontend can
   * mint the session id at send time and persist the user's message under it
   * before the turn finishes.
   */
  function resolveChatSession(
    sessionId: string | undefined,
    profile: UserProfile | undefined,
    language: ReplyLanguage | undefined,
  ): AgentContext {
    const existing = touchSession(sessionId);
    if (existing) {
      if (profile) existing.profile = { ...existing.profile, ...profile };
      if (language) existing.language = language;
      return existing;
    }
    const created = createSession(profile ?? {}, language ?? 'auto');
    if (sessionId?.trim()) created.sessionId = sessionId;
    putSession(created);
    return created;
  }

  // P170: same-origin CORS. Reflect the Origin only when it matches the host
  // the request arrived on (Host or X-Forwarded-Host); foreign origins get no
  // Access-Control-* headers, so browsers block cross-site calls to /api/*.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = isCorsAllowed(origin, requestHost(req.headers));
    if (req.method === 'OPTIONS') {
      // Same shape as cors() defaults: always 204 with an empty body.
      if (origin) {
        res.vary('Origin');
        if (allowed) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
          const requested = req.headers['access-control-request-headers'];
          if (requested) {
            const value = Array.isArray(requested) ? requested.join(',') : requested;
            res.setHeader('Access-Control-Allow-Headers', value);
            res.vary('Access-Control-Request-Headers');
          }
        }
      }
      res.setHeader('Content-Length', '0');
      res.status(204).end();
      return;
    }
    if (origin) {
      res.vary('Origin');
      if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
    }
    next();
  });
  // Cheap counter; runs before everything so rejected requests are still counted.
  app.use((_req, _res, next) => {
    usageMetrics.recordRequest();
    next();
  });
  // Registered before the body parser so even rejected payloads get a log line.
  app.use(createRequestLogger(options.requestLogWriter));
  // P147: clickjacking guard on every response — static, SPA and /api alike.
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  // F26: security headers on every /api/* response.
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  // P05: remember the most recent 5xx under /api/* for the verbose health probe.
  app.use('/api', (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 500) return;
      const raw = req.originalUrl || req.url || '';
      const queryAt = raw.indexOf('?');
      apiErrors.record({
        ts: new Date().toISOString(),
        method: req.method,
        path: queryAt === -1 ? raw : raw.slice(0, queryAt),
        status: res.statusCode,
      });
    });
    next();
  });
  app.use(express.json());
  app.use(handleBodyErrors);

  // Shared per-IP budget for both chat endpoints (30 req/min).
  const chatRateLimit = createRateLimiter();
  const chatGuards = [chatRateLimit, rejectOversizedMessage];

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const report = buildHealthReport(distDir, llmConfigured, llmModel);
    // P05: verbose diagnostics are localhost-only; remote callers always get
    // the plain public payload with no `verbose` key.
    if (req.query.verbose === '1' && isLoopback(req)) {
      res.status(report.status === 'ok' ? 200 : 503).json({
        ...report,
        verbose: buildVerboseHealth(distDir, apiErrors.latest()),
      });
      return;
    }
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(buildVersionReport());
  });

  // Localhost-only admin endpoint: zero the usage counters without a restart.
  app.post('/api/metrics/reset', (req, res) => {
    if (!isLoopback(req)) {
      res.status(403).json(errorBody(res, 'forbidden: localhost only'));
      return;
    }
    usageMetrics.reset();
    res.json({ ok: true, metrics: usageMetrics.snapshot() });
  });

  app.get('/api/tools', (_req, res) => {
    const meta = [
      { name: 'analyze_profile', label: '资料优化', icon: '📝' },
      { name: 'coach_conversation', label: '聊天指导', icon: '💬' },
      { name: 'plan_date', label: '约会规划', icon: '📅' },
      { name: 'check_compatibility', label: '匹配分析', icon: '💕' },
      { name: 'get_relationship_advice', label: '关系建议', icon: '🎯' },
    ];

    const tools = meta.map((entry) => {
      const schema = getTool(entry.name)?.parameters as
        | { properties?: Record<string, { type?: string; description?: string; enum?: string[]; items?: { type?: string } }>; required?: string[] }
        | undefined;

      const inputs = Object.entries(schema?.properties ?? {}).map(([name, prop]) => ({
        name,
        type: prop.type ?? 'string',
        items: prop.items?.type,
        enum: prop.enum,
        description: prop.description,
        required: schema?.required?.includes(name) ?? false,
      }));

      return { ...entry, inputs };
    });

    res.json({ tools });
  });

  app.get('/api/sessions', (_req, res) => {
    const now = Date.now();
    evictIdleSessions(now);

    let oldestLastActive = now;
    for (const entry of sessions.values()) {
      if (entry.lastActiveAt < oldestLastActive) oldestLastActive = entry.lastActiveAt;
    }

    // Counts and ages only — never session ids or profile data.
    res.json({
      count: sessions.size,
      oldestAgeSec: sessions.size > 0 ? Math.floor((now - oldestLastActive) / 1000) : 0,
    });
  });

  app.post('/api/session', (req, res) => {
    const profile = (req.body?.profile ?? {}) as UserProfile;
    const session = createSession(profile);
    putSession(session);
    res.json({ sessionId: session.sessionId });
  });

  app.post('/api/session/restore', (req, res) => {
    const { sessionId, messages, profile } = req.body as {
      sessionId?: string;
      messages?: Array<{ role: string; content: string }>;
      profile?: UserProfile;
    };

    if (!sessionId?.trim()) {
      return res.status(400).json(errorBody(res, 'sessionId is required'));
    }

    // P177: cap restored history to the same budget as live turns, and hold
    // each stored message to the /api/chat per-message ceiling.
    const history = capHistory(
      (messages ?? [])
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim(),
        )
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content.slice(0, MAX_MESSAGE_CHARS),
        })),
      historyLimitsFromEnv(),
    );

    const existing = touchSession(sessionId);
    const session = existing ?? createSession(profile ?? {});
    session.sessionId = sessionId;
    if (profile) session.profile = { ...session.profile, ...profile };
    if (history.length > 0) session.conversationHistory = history;
    // P339: refill the stored memory from the restored history. Forgotten
    // keys still block re-adding, so a fact the user deleted stays gone.
    ingestSessionMemory(session);

    putSession(session);
    res.json({ sessionId, restored: true, messageCount: history.length });
  });

  app.delete('/api/session/:id', (req, res) => {
    // Deleting must not count as activity, so touch the map directly. The
    // shard goes with it — a session dropped before its shard was ever
    // rehydrated still reports deleted.
    const inMemory = sessions.delete(req.params.id);
    const onDisk = sessionStore.delete(req.params.id);
    res.json({ deleted: inMemory || onDisk });
  });

  app.get('/api/session/:id', (req, res) => {
    const session = touchSession(req.params.id);
    if (!session) return res.status(404).json(errorBody(res, 'Session not found'));
    res.json({
      sessionId: session.sessionId,
      profile: session.profile,
      history: session.conversationHistory,
      memory: sessionMemory(session),
    });
  });

  // P339: the stored, keyed facts a conversation remembers — the source
  // behind the 记忆 capsule's expandable list.
  app.get('/api/conversations/:id/memory', (req, res) => {
    const session = touchSession(req.params.id);
    if (!session) {
      return res.status(404).json(errorBody(res, 'Conversation not found'));
    }
    const facts = sessionMemoryFacts(session);
    res.json({ count: facts.length, items: facts });
  });

  // P339: 忘记这条 — the deleted key joins the session's forgotten set so
  // a later identical statement or a history restore never re-adds it.
  app.delete('/api/conversations/:id/memory/:key', (req, res) => {
    const session = touchSession(req.params.id);
    if (!session) {
      return res.status(404).json(errorBody(res, 'Conversation not found'));
    }
    if (!forgetMemoryFact(session, req.params.key)) {
      return res
        .status(404)
        .json(errorBody(res, 'Memory fact not found', { deleted: false }));
    }
    persistContext(session);
    res.json({ deleted: true });
  });

  app.post('/api/chat', ...chatGuards, async (req, res) => {
    const { sessionId, message, profile, language, replyLength, previousReplies, intent } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
      language?: unknown;
      replyLength?: unknown;
      previousReplies?: unknown;
      intent?: unknown;
    };

    const sanitized = sanitizeMessage(message ?? '');
    if (!sanitized.trim()) {
      return res.status(400).json(errorBody(res, 'Message is required'));
    }

    if (language !== undefined && parseReplyLanguage(language) === undefined) {
      return res.status(400).json(errorBody(res, 'language must be one of "zh", "en", "auto"'));
    }

    // P196: a non-default reply-length preference arrives as a per-request
    // hint — it is never pinned to the session, so omitting the field always
    // restores the default prompt.
    if (replyLength !== undefined && parseReplyLength(replyLength) === undefined) {
      return res.status(400).json(errorBody(res, 'replyLength must be one of "concise", "detailed"'));
    }

    // P284: 「换一个」 sends the last shown versions so the model is told not
    // to repeat them; a malformed field is a 400 like the other enum hints.
    const avoidReplies = parsePreviousReplies(previousReplies);
    if (avoidReplies === null) {
      return res.status(400).json(errorBody(res, 'previousReplies must be an array of strings'));
    }

    // P345: the starter capsule this turn opened with — a malformed value
    // gets the same 400 the other enum hints get.
    if (intent !== undefined && parseChatIntent(intent) === undefined) {
      return res.status(400).json(errorBody(res, 'intent must be one of "profile", "chat-coach", "date-plan"'));
    }

    const session = resolveChatSession(sessionId, profile, parseReplyLanguage(language));
    const startedAt = Date.now();
    const latency = createChatLatencyRecorder(res, startedAt);
    // P339: extract this turn's facts into the session memory — deduped,
    // deterministic, and never undone by an upstream failure: the user
    // stated the fact whether or not the reply lands.
    rememberUserMessage(session, sanitized);

    try {
      const { content, meta } = await harness.chatWithMeta(
        sanitized,
        session,
        parseReplyLength(replyLength),
        avoidReplies,
        latency.onEvent,
        parseChatIntent(intent),
      );
      usageMetrics.recordChat(Date.now() - startedAt, true);
      // F21: meta omitted entirely when tokens are unknown (badge stays hidden).
      const replyMeta =
        meta.tokens !== undefined
          ? { ...meta, latencyMs: Date.now() - startedAt }
          : undefined;
      persistContext(session);
      // P390: `strategy` surfaces the regen route the reply picked — absent
      // on normal turns and when the model omitted its marker line.
      res.json({ sessionId: session.sessionId, reply: content, language: session.language ?? 'auto', meta: replyMeta, memory: sessionMemory(session), strategy: meta.strategy });
    } catch (err) {
      usageMetrics.recordChat(Date.now() - startedAt, false);
      // The user's turn already mutated the session memory — persist that
      // even though the reply never landed.
      persistContext(session);
      const msg = err instanceof Error ? err.message : String(err);
      // P166: an upstream deadline is a 504 Gateway Timeout, not a server bug.
      res.status(err instanceof LLMTimeoutError ? 504 : 500).json(errorBody(res, msg));
    }
  });

  app.post('/api/chat/stream', ...chatGuards, async (req, res) => {
    const { sessionId, message, profile, language, replyLength, previousReplies, intent } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
      language?: unknown;
      replyLength?: unknown;
      previousReplies?: unknown;
      intent?: unknown;
    };

    const sanitized = sanitizeMessage(message ?? '');
    if (!sanitized.trim()) {
      return res.status(400).json(errorBody(res, 'Message is required'));
    }

    if (language !== undefined && parseReplyLanguage(language) === undefined) {
      return res.status(400).json(errorBody(res, 'language must be one of "zh", "en", "auto"'));
    }

    if (replyLength !== undefined && parseReplyLength(replyLength) === undefined) {
      return res.status(400).json(errorBody(res, 'replyLength must be one of "concise", "detailed"'));
    }

    const avoidReplies = parsePreviousReplies(previousReplies);
    if (avoidReplies === null) {
      return res.status(400).json(errorBody(res, 'previousReplies must be an array of strings'));
    }

    // P345: same starter-intent validation as /api/chat.
    if (intent !== undefined && parseChatIntent(intent) === undefined) {
      return res.status(400).json(errorBody(res, 'intent must be one of "profile", "chat-coach", "date-plan"'));
    }

    const session = resolveChatSession(sessionId, profile, parseReplyLanguage(language));
    const startedAt = Date.now();
    rememberUserMessage(session, sanitized);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // P146: tell any reverse proxy (nginx proxy_buffering) not to buffer SSE.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // F19: SSE keepalive — comment pings keep proxies from dropping idle streams.
    // Interval is overridable (tests use a scaled-down value).
    const KEEPALIVE_MS = Number(process.env.SSE_KEEPALIVE_MS) || 15_000;
    const keepalive = setInterval(() => {
      res.write(': ping\n\n');
    }, KEEPALIVE_MS);
    const stopKeepalive = () => clearInterval(keepalive);
    // P165: a client disconnect aborts the upstream LLM call so we stop
    // generating (and paying for) a reply nobody will receive.
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    res.on('close', stopKeepalive);
    res.on('finish', stopKeepalive);

    let failed = false;
    // P231: first SSE event latency lands on the access log line as
    // `firstEventMs`, so tool-turn waits are measurable from the log.
    let firstEventRecorded = false;
    // P300: first CONTENT event (delta/message) latency + executed tool
    // count land as `firstTokenMs`/`toolCalls` — the user-visible first
    // character and the double-upstream-call signal, respectively.
    const latency = createChatLatencyRecorder(res, startedAt);
    try {
      for await (const ev of harness.run(sanitized, session, controller.signal, parseReplyLength(replyLength), avoidReplies, parseChatIntent(intent))) {
        // Socket already closed: stop before writing to it again.
        if (controller.signal.aborted) break;
        if (!firstEventRecorded) {
          firstEventRecorded = true;
          res.locals.firstEventMs = Date.now() - startedAt;
        }
        latency.onEvent(ev);
        let event = ev;
        if (event.type === 'done') {
          // F21: attach the request latency so the UI can show the meta badge.
          const d = event.data as { sessionId: string };
          event = {
            type: 'done',
            data: {
              ...d,
              latencyMs: Date.now() - startedAt,
              memory: sessionMemory(session),
            },
          };
        } else if (event.type === 'error') {
          // P04: harness-level failures get the same correlation id.
          const d = event.data as Record<string, unknown>;
          event = { type: 'error', data: { ...d, requestId: requestId(res) } };
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done') break;
      }
    } catch (err) {
      // AbortError from a dead socket is not a server failure — skip the
      // error event since there is nobody left to read it.
      if (!controller.signal.aborted) {
        failed = true;
        const msg = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: msg, requestId: requestId(res) } })}\n\n`);
      }
    }
    stopKeepalive();
    // Whatever the turn left behind — history on success, just the new
    // memory facts on an abort or error — is now on disk.
    persistContext(session);

    // Aborted turns are not success samples: skip them and leave the dead
    // socket alone (no res.end on a closed connection).
    if (!controller.signal.aborted) {
      usageMetrics.recordChat(Date.now() - startedAt, !failed);
      res.end();
    }
  });

  // Terminal /api 404: anything unmatched above is a missing endpoint, not a
  // SPA route — reply JSON so clients never hit `Unexpected token '<'`.
  app.use('/api', (_req, res) => {
    res.status(404).json(errorBody(res, 'Not found'));
  });

  // P314: serve the SPA shell from a whole-file read, not sendFile's stream —
  // a mid-build truncation could split a streamed response into "200 +
  // partial body" before the error callback fired, and the callback then
  // answered 200 with an error JSON. A read result only counts when it still
  // contains the #root mount point (a half-written index.html fails the same
  // way a missing one does). On any failure the last good copy is served;
  // with none cached the answer is 503 + Retry-After so the client can poll
  // until the rebuild lands. It is never 200 with `{"error": ...}`.
  let lastGoodSpaShell: string | null = null;
  const spaShellFile = path.join(distDir, 'index.html');
  const serveSpaShell: express.Handler = (_req, res) => {
    fs.readFile(spaShellFile, 'utf8', (err, html) => {
      if (!err && html.includes('id="root"')) {
        lastGoodSpaShell = html;
        res.type('html').send(html);
        return;
      }
      if (lastGoodSpaShell !== null) {
        res.type('html').send(lastGoodSpaShell);
        return;
      }
      res.set('Retry-After', '1');
      res.status(503).json(errorBody(res, 'Frontend not built'));
    });
  };
  // /index.html goes through the guarded read too — express.static would
  // otherwise stream a half-written shell straight to the client.
  app.get('/index.html', serveSpaShell);
  // `index: false` keeps express.static from serving index.html itself —
  // every shell request (`/`, deep routes) funnels into the guarded read.
  app.use(express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      // P424: Vite emits content-hashed bundles under assets/ — the filename
      // changes whenever the bytes do, so they can be cached forever. Other
      // static files (favicon.svg, ...) keep a short revalidation window.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    },
  }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('*', serveSpaShell);

  return app;
}
