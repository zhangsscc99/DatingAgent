/**
 * Process-local usage counters exposed on `/api/health` under `metrics`.
 * Nothing is persisted: everything resets when the process restarts.
 */

export interface MetricsSnapshot {
  requests: {
    /** Every HTTP request that reached the app (static assets and 404s included). */
    total: number;
    /** Requests to `/api/chat` and `/api/chat/stream`. */
    chat: number;
    /** Chat requests that ended in an error (LLM failure, abort, unknown tool). */
    chatErrors: number;
  };
  tokens: {
    /** Prompt tokens reported by the LLM provider across all turns. */
    prompt: number;
    completion: number;
    total: number;
  };
  latency: {
    /** Completed chat turns measured. */
    chatSamples: number;
    /** Mean chat duration, one decimal place. */
    avgMs: number;
    lastMs: number;
    maxMs: number;
  };
  /** ISO timestamp of the first counter update (process start for practical purposes). */
  startedAt: string;
  /** Resident set size at snapshot time, rounded to whole MB — makes memory growth observable. */
  rssMB: number;
}

/** Non-negative integer guard so a malformed provider payload cannot poison the counters. */
function asCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export class UsageMetrics {
  private requestsTotal = 0;
  private chatTotal = 0;
  private chatErrors = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private latencySamples = 0;
  private latencyTotalMs = 0;
  private lastMs = 0;
  private maxMs = 0;
  private startedAt = new Date().toISOString();

  recordRequest(): void {
    this.requestsTotal += 1;
  }

  /** One completed chat turn. `ok` is false when the turn ended in an error. */
  recordChat(durationMs: number, ok: boolean): void {
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    this.chatTotal += 1;
    if (!ok) this.chatErrors += 1;
    this.latencySamples += 1;
    this.latencyTotalMs += ms;
    this.lastMs = round1(ms);
    if (ms > this.maxMs) this.maxMs = ms;
  }

  /** Token usage for a single LLM call, as reported by the provider. */
  recordTokens(promptTokens: number, completionTokens: number): void {
    this.promptTokens += asCount(promptTokens);
    this.completionTokens += asCount(completionTokens);
  }

  /** Zero every counter without restarting the process (admin/reset endpoint). */
  reset(): void {
    this.requestsTotal = 0;
    this.chatTotal = 0;
    this.chatErrors = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.latencySamples = 0;
    this.latencyTotalMs = 0;
    this.lastMs = 0;
    this.maxMs = 0;
    this.startedAt = new Date().toISOString();
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: {
        total: this.requestsTotal,
        chat: this.chatTotal,
        chatErrors: this.chatErrors,
      },
      tokens: {
        prompt: this.promptTokens,
        completion: this.completionTokens,
        total: this.promptTokens + this.completionTokens,
      },
      latency: {
        chatSamples: this.latencySamples,
        avgMs:
          this.latencySamples > 0 ? round1(this.latencyTotalMs / this.latencySamples) : 0,
        lastMs: this.lastMs,
        maxMs: round1(this.maxMs),
      },
      startedAt: this.startedAt,
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Shared counters for the running server. */
export const usageMetrics = new UsageMetrics();
