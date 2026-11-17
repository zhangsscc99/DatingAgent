export interface ServerConfig {
  port: number;
  llm: {
    configured: boolean;
    baseUrl: string;
    model: string;
  };
}

function parsePort(raw: string | undefined): number {
  const value = raw?.trim() ?? '3001';

  if (!/^\d+$/.test(value)) {
    console.error(`[env] Invalid PORT="${raw}" — must be a number between 1 and 65535`);
    process.exit(1);
  }

  const port = Number(value);
  if (port < 1 || port > 65535) {
    console.error(`[env] Invalid PORT=${port} — must be between 1 and 65535`);
    process.exit(1);
  }

  return port;
}

function normalizeUrl(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  try {
    new URL(value);
    return value.replace(/\/+$/, '');
  } catch {
    console.error(`[env] Invalid ${name}="${raw}" — must be a valid URL`);
    process.exit(1);
  }
}

function normalizeModel(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  if (value.length === 0) {
    console.error('[env] LLM_MODEL cannot be empty when set');
    process.exit(1);
  }
  return value;
}

/** P257 — generous reply cap so long answers aren't truncated. */
export const DEFAULT_LLM_MAX_TOKENS = 1600;

/**
 * P257 — provider-side "thinking" costs several seconds per upstream call and
 * a tool turn pays it twice. Off unless LLM_ENABLE_THINKING is "1"/"true".
 */
export function parseLlmEnableThinking(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Non-positive or non-numeric values fall back to the default. */
export function parseLlmMaxTokens(raw: string | undefined): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LLM_MAX_TOKENS;
}

/** Validate env on startup and emit clear, actionable logs. */
export function loadAndValidateEnv(): ServerConfig {
  const port = parsePort(process.env.PORT);
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  const baseUrl = normalizeUrl(
    process.env.LLM_BASE_URL,
    'https://api.openai.com/v1',
    'LLM_BASE_URL',
  );
  const model = normalizeModel(process.env.LLM_MODEL, 'gpt-4o-mini');
  const configured = apiKey.length > 0;

  console.log('[env] Configuration loaded');
  console.log(`[env]   PORT=${port}`);

  if (configured) {
    console.log('[env]   LLM=enabled');
    console.log(`[env]   LLM_BASE_URL=${baseUrl}`);
    console.log(`[env]   LLM_MODEL=${model}`);
    console.log('[env]   OPENAI_API_KEY=set (hidden)');
  } else {
    console.warn('[env]   LLM=mock mode — set OPENAI_API_KEY for live responses');
    console.log(`[env]   LLM_BASE_URL=${baseUrl} (used when key is set)`);
    console.log(`[env]   LLM_MODEL=${model} (used when key is set)`);
  }

  if (process.env.NODE_ENV === 'production' && !configured) {
    console.warn('[env] Running in production without OPENAI_API_KEY — demo/mock responses only');
  }

  return {
    port,
    llm: { configured, baseUrl, model },
  };
}
