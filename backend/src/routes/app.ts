import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHarness, createSession } from '../agent/harness.js';
import type { AgentContext, UserProfile } from '../agent/types.js';
import { buildHealthReport } from '../lib/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harness = new AgentHarness();
const sessions = new Map<string, AgentContext>();
const frontendDist = path.resolve(__dirname, '../../../frontend/dist');

export interface AppOptions {
  llmConfigured?: boolean;
}

export function createApp(options: AppOptions = {}) {
  const llmConfigured = options.llmConfigured ?? Boolean(process.env.OPENAI_API_KEY?.trim());
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const report = buildHealthReport(frontendDist, llmConfigured);
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  app.get('/api/tools', (_req, res) => {
    res.json({
      tools: [
        { name: 'analyze_profile', label: '资料优化', icon: '📝' },
        { name: 'coach_conversation', label: '聊天指导', icon: '💬' },
        { name: 'plan_date', label: '约会规划', icon: '📅' },
        { name: 'check_compatibility', label: '匹配分析', icon: '💕' },
        { name: 'get_relationship_advice', label: '关系建议', icon: '🎯' },
      ],
    });
  });

  app.post('/api/session', (req, res) => {
    const profile = (req.body?.profile ?? {}) as UserProfile;
    const session = createSession(profile);
    sessions.set(session.sessionId, session);
    res.json({ sessionId: session.sessionId });
  });

  app.post('/api/session/restore', (req, res) => {
    const { sessionId, messages, profile } = req.body as {
      sessionId?: string;
      messages?: Array<{ role: string; content: string }>;
      profile?: UserProfile;
    };

    if (!sessionId?.trim()) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const history = (messages ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const existing = sessions.get(sessionId);
    const session = existing ?? createSession(profile ?? {});
    session.sessionId = sessionId;
    if (profile) session.profile = { ...session.profile, ...profile };
    if (history.length > 0) session.conversationHistory = history;

    sessions.set(sessionId, session);
    res.json({ sessionId, restored: true, messageCount: history.length });
  });

  app.get('/api/session/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
      sessionId: session.sessionId,
      profile: session.profile,
      history: session.conversationHistory,
    });
  });

  app.post('/api/chat', async (req, res) => {
    const { sessionId, message, profile } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
    };

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let session: AgentContext;
    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!;
      if (profile) session.profile = { ...session.profile, ...profile };
    } else {
      session = createSession(profile ?? {});
      sessions.set(session.sessionId, session);
    }

    try {
      const reply = await harness.chat(message, session);
      res.json({ sessionId: session.sessionId, reply });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    const { sessionId, message, profile } = req.body as {
      sessionId?: string;
      message: string;
      profile?: UserProfile;
    };

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let session: AgentContext;
    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!;
      if (profile) session.profile = { ...session.profile, ...profile };
    } else {
      session = createSession(profile ?? {});
      sessions.set(session.sessionId, session);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const event of harness.run(message, session)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done') break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message: msg } })}\n\n`);
    }

    res.end();
  });

  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'Frontend not built' });
    });
  });

  return app;
}
