import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentContext, MemoryFact, Message, ReplyLanguage } from '../agent/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * P359 — sessions and their memories used to live only in a process-local
 * Map, so every pm2 restart/deploy wiped every conversation mid-chat (the
 * walkthrough lost 8 bubbles + 4 facts to a single SIGINT). Each session
 * now also lives as one JSON shard under a gitignored data dir; the in-
 * memory Map stays as the cache and a cache miss lazily rehydrates from
 * disk, so a fresh process (or a second app instance) behaves exactly like
 * a restart and still finds the session.
 *
 * Writes are atomic (write-temp-then-rename) and synchronous — one discrete
 * write per mutating request, small enough that debouncing buys nothing.
 * Reads never throw: a corrupt or half-written shard logs one warning,
 * answers "no session", and is left on disk for forensics — never deleted.
 */

/** Only these characters may end up in a shard filename — anything else is hashed. */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

const SHARD_VERSION = 1;

/** Directory holding the shards. DATING_SESSIONS_DIR relocates it (tests
 * point it at a temp dir); the default is <repo>/backend/data/sessions for
 * both the tsx sources (src/lib) and the compiled server (dist/lib). */
export function sessionsDir(): string {
  const fromEnv = process.env.DATING_SESSIONS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, '../../data/sessions');
}

interface SerializedContext {
  sessionId: string;
  profile: AgentContext['profile'];
  conversationHistory: Message[];
  language?: ReplyLanguage;
  memoryFacts?: MemoryFact[];
  /** The Set is persisted as a plain string list. */
  forgottenFactKeys?: string[];
}

interface SessionShard {
  v: number;
  lastActiveAt: number;
  context: SerializedContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const VALID_LANGUAGES = new Set(['zh', 'en', 'auto']);

function isMessage(value: unknown): value is Message {
  return (
    isRecord(value) &&
    typeof value.role === 'string' &&
    VALID_ROLES.has(value.role) &&
    typeof value.content === 'string'
  );
}

function isMemoryFact(value: unknown): value is MemoryFact {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.text === 'string' &&
    typeof value.ts === 'number' &&
    Number.isFinite(value.ts)
  );
}

/** Rebuild a live context from shard bytes. Returns undefined when the
 * top-level shape is unusable; individually malformed entries inside an
 * otherwise good shard are dropped rather than sinking the whole file. */
function deserializeContext(raw: unknown): AgentContext | undefined {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) {
    return undefined;
  }
  const context: AgentContext = {
    sessionId: raw.sessionId,
    profile: isRecord(raw.profile) ? (raw.profile as AgentContext['profile']) : {},
    conversationHistory: Array.isArray(raw.conversationHistory)
      ? raw.conversationHistory.filter(isMessage)
      : [],
  };
  if (typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language)) {
    context.language = raw.language as ReplyLanguage;
  }
  if (Array.isArray(raw.memoryFacts)) {
    context.memoryFacts = raw.memoryFacts.filter(isMemoryFact);
  }
  if (Array.isArray(raw.forgottenFactKeys)) {
    const keys = raw.forgottenFactKeys.filter((k): k is string => typeof k === 'string');
    if (keys.length > 0) context.forgottenFactKeys = new Set(keys);
  }
  return context;
}

function serializeContext(context: AgentContext): SerializedContext {
  return {
    sessionId: context.sessionId,
    profile: context.profile ?? {},
    conversationHistory: context.conversationHistory ?? [],
    ...(context.language ? { language: context.language } : {}),
    ...(context.memoryFacts?.length ? { memoryFacts: context.memoryFacts } : {}),
    ...(context.forgottenFactKeys?.size
      ? { forgottenFactKeys: [...context.forgottenFactKeys] }
      : {}),
  };
}

export interface StoredSession {
  context: AgentContext;
  lastActiveAt: number;
}

/**
 * The on-disk session store for one data dir. All fs failures are swallowed
 * with at most one log line each — persistence must never take a request
 * (or the process) down with it.
 */
export class SessionStore {
  private readonly dir: string;
  private readonly warned = new Set<string>();

  constructor(dir: string = sessionsDir()) {
    this.dir = dir;
  }

  /** The shard path for a session id — always inside the store dir. Unsafe
   * ids (path separators, dots, unicode) collapse to their sha256 so a
   * traversal like `../../etc/passwd` can never escape. */
  fileFor(sessionId: string): string {
    const base = SAFE_SESSION_ID.test(sessionId)
      ? sessionId
      : createHash('sha256').update(`session:${sessionId}`).digest('hex');
    return path.join(this.dir, `${base}.json`);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try {
      console.warn(`[session-store] ${message}`);
    } catch {
      /* console unavailable — the warning is best-effort anyway */
    }
  }

  /** Load a session from its shard. Missing/corrupt/foreign-id shards all
   * answer undefined; corrupt ones log once and keep their file. */
  load(sessionId: string): StoredSession | undefined {
    const file = this.fileFor(sessionId);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.warnOnce(file, `ignoring corrupt shard ${path.basename(file)} (unparseable)`);
      return undefined;
    }
    if (!isRecord(parsed) || typeof parsed.lastActiveAt !== 'number') {
      this.warnOnce(file, `ignoring corrupt shard ${path.basename(file)} (bad envelope)`);
      return undefined;
    }
    const context = deserializeContext(parsed.context);
    if (!context || context.sessionId !== sessionId) {
      this.warnOnce(file, `ignoring corrupt shard ${path.basename(file)} (bad context)`);
      return undefined;
    }
    return { context, lastActiveAt: parsed.lastActiveAt };
  }

  /** Atomically persist one session entry: full JSON to `<file>.tmp`, then rename. */
  save(context: AgentContext, lastActiveAt: number): void {
    const file = this.fileFor(context.sessionId);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const shard: SessionShard = {
        v: SHARD_VERSION,
        lastActiveAt,
        context: serializeContext(context),
      };
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(shard), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      this.warnOnce(
        `write:${file}`,
        `could not persist session shard ${path.basename(file)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Drop the shard for a deleted/evicted session. Returns true when a file
   * was actually removed — the caller ORs it with the cache result so a
   * not-yet-rehydrated session still reports deleted. */
  delete(sessionId: string): boolean {
    try {
      fs.unlinkSync(this.fileFor(sessionId));
      return true;
    } catch {
      return false;
    }
  }
}
