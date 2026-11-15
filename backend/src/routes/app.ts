import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHarness, createSession, parseReplyLanguage } from '../agent/harness.js';
import type { AgentContext, ChatResult, ReplyLanguage, UserProfile } from '../agent/types.js';
import { buildHealthReport } from '../lib/health.js';
import { buildVersionReport } from '../lib/version.js';
import { createRequestLogger, errorBody, requestId } from '../lib/request-log.js';
import { usageMetrics } from '../lib/metrics.js';
import { sanitizeMessage } from '../lib/sanitize.js';
import { getTool } from '../tools/registry.js';
import {
  createRateLimiter,
  handleBodyErrors,
  rejectOversizedMessage,
} from '../lib/guardrails.js';

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

const sessions = new Map<string, SessionEntry>();

/** Drop sessions that have been idle past the TTL. Cheap: at most MAX_SESSIONS entries. */
function evictIdleSessions(now = Date.now()): void {
  for (const [id, entry] of sessions) {
    if (now - entry.lastActiveAt > SESSION_IDLE_TTL_MS) sessions.delete(id);
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
  }
}

/** Insert or refresh a session, then trim the store to its cap. */
function putSession(context: AgentContext, now = Date.now()): void {
  evictIdleSessions(now);
  sessions.set(context.sessionId, { context, lastActiveAt: now });
  enforceSessionCap();
}

/** Read a session and mark it active. Returns undefined when missing or expired. */
function touchSession(id: string | undefined, now = Date.now()): AgentContext | undefined {
  if (!id) return undefined;
  const entry = sessions.get(id);
  if (!entry) return undefined;
  if (now - entry.lastActiveAt > SESSION_IDLE_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  entry.lastActiveAt = now;
  return entry.context;
}

export interface AppOptions {
  llmConfigured?: boolean;
  llmModel?: string;
}

/**
 * Resolve the session for one chat turn. A pinned `language` sticks to the
 * session so later turns keep the same reply language without resending it.
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
  putSession(created);
  return created;
}

export function createApp(options: AppOptions = {}) {
  const llmConfigured = options.llmConfigured ?? Boolean(process.env.OPENAI_API_KEY?.trim());
  const llmModel = options.llmModel ?? (process.env.LLM_MODEL?.trim() || 'gpt-4o-mini');
  const app = express();
  app.use(cors());
  // Cheap counter; runs before everything so rejected requests are still counted.
  app.use((_req, _res, next) => {
    usageMetrics.recordRequest();
    next();
  });
  // Registered before the body parser so even rejected payloads get a log line.
  app.use(createRequestLogger());
  app.use(express.json());
  app.use(handleBodyErrors);

  // Shared per-IP budget for both chat endpoints (30 req/min).
  const chatRateLimit = createRateLimiter();
  const chatGuards = [chatRateLimit, rejectOversizedMessage];

  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const report = buildHealthReport(frontendDist, llmConfigured, llmModel);
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(buildVersionReport());
  });

  // Localhost-only admin endpoint: zero the usage counters without a restart.
  app.post('/api/metrics/reset', (req, res) => {
    const remote = req.ip ?? '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLocal) {
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

    const history = (messages ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const existing = touchSession(sessionId);
    const session = existing ?? createSession(profile ?? {});
    session.sessionId = sessionId;
    if (profile) session.profile = { ...session.profile, ...profile };
    if (history.length > 0) session.conversationHistory = history;

    putSession(session);
    res.json({ sessionId, restored: true, messageCount: history.length });
  });

  app.delete('/api/session/:id', (req, res) => {
    // Deleting must not count as activity, so touch the map directly.
    const deleted = sessions.delete(req.params.id);
    res.json({ deleted });
  });

  app.get('/api/session/:id', (req, res) => {
    const session = touchSession(req.params.id);
    if (!session) return res.status(404).json(errorBody(res, 'Session not found'));
    res.json({
      sessionId: session.sessionId,
      profile: session.profile,
      history: session.conversationHistory,
    });
  });

  app.post('/api/chat', ...chatGuards, async (req, res) => {
    const { sessionId, message, profile, language } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
      language?: unknown;
    };

    const sanitized = sanitizeMessage(message ?? '');
    if (!sanitized.trim()) {
      return res.status(400).json(errorBody(res, 'Message is required'));
    }

    if (language !== undefined && parseReplyLanguage(language) === undefined) {
      return res.status(400).json(errorBody(res, 'language must be one of "zh", "en", "auto"'));
    }

    const session = resolveChatSession(sessionId, profile, parseReplyLanguage(language));
    const startedAt = Date.now();

    try {
      const { content, meta } = await harness.chatWithMeta(sanitized, session);
      usageMetrics.recordChat(Date.now() - startedAt, true);
      // F21: meta omitted entirely when tokens are unknown (badge stays hidden).
      const replyMeta =
        meta.tokens !== undefined
          ? { ...meta, latencyMs: Date.now() - startedAt }
          : undefined;
      res.json({ sessionId: session.sessionId, reply: content, language: session.language ?? 'auto', meta: replyMeta });
    } catch (err) {
      usageMetrics.recordChat(Date.now() - startedAt, false);
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json(errorBody(res, msg));
    }
  });

  app.post('/api/chat/stream', ...chatGuards, async (req, res) => {
    const { sessionId, message, profile, language } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
      language?: unknown;
    };

    const sanitized = sanitizeMessage(message ?? '');
    if (!sanitized.trim()) {
      return res.status(400).json(errorBody(res, 'Message is required'));
    }

    if (language !== undefined && parseReplyLanguage(language) === undefined) {
      return res.status(400).json(errorBody(res, 'language must be one of "zh", "en", "auto"'));
    }

    const session = resolveChatSession(sessionId, profile, parseReplyLanguage(language));
    const startedAt = Date.now();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // F19: SSE keepalive — comment pings keep proxies from dropping idle streams.
    // Interval is overridable (tests use a scaled-down value).
    const KEEPALIVE_MS = Number(process.env.SSE_KEEPALIVE_MS) || 15_000;
    const keepalive = setInterval(() => {
      res.write(': ping\n\n');
    }, KEEPALIVE_MS);
    const stopKeepalive = () => clearInterval(keepalive);
    res.on('close', stopKeepalive);
    res.on('finish', stopKeepalive);

    let failed = false;
    try {
      for await (const ev of harness.run(sanitized, session)) {
        let event = ev;
        if (event.type === 'done') {
          // F21: attach the request latency so the UI can show the meta badge.
          const d = event.data as { sessionId: string };
          event = {
            type: 'done',
            data: { ...d, latencyMs: Date.now() - startedAt },
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
      failed = true;
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: msg, requestId: requestId(res) } })}\n\n`);
    }
    stopKeepalive();

    usageMetrics.recordChat(Date.now() - startedAt, !failed);
    res.end();
  });

  app.use(express.static(frontendDist));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) res.status(404).json(errorBody(res, 'Frontend not built'));
    });
  });

  return app;
}
