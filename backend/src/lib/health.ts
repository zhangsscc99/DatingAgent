import fs from 'node:fs';
import path from 'node:path';
import { serverStartedAt } from '../config/runtime.js';
import { BUILD_INFO } from './build-info.js';
import { usageMetrics, type MetricsSnapshot } from './metrics.js';
import type { LastApiError } from './last-error.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  /** Why `status` is degraded; 'frontend-dist' wins when both causes hit. null when ok. */
  degradedReason: 'llm' | 'frontend-dist' | null;
  service: string;
  version: string;
  uptimeSeconds: number;
  /** Node runtime version (process.version), for deploy verification. */
  node: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  llmConfigured: boolean;
  /** Configured LLM model name (never the API key), for deploy verification. */
  llmModel: string;
  frontend: {
    distPath: string;
    built: boolean;
    indexExists: boolean;
  };
  /** In-memory counters since process start; nothing is persisted. */
  metrics: MetricsSnapshot;
}

export function buildHealthReport(
  frontendDist: string,
  llmConfigured: boolean,
  llmModel = 'gpt-4o-mini',
): HealthReport {
  const indexPath = path.join(frontendDist, 'index.html');
  const indexExists = fs.existsSync(indexPath);
  const degradedReason = !indexExists ? 'frontend-dist' : !llmConfigured ? 'llm' : null;
  const mem = process.memoryUsage();

  return {
    status: degradedReason === null ? 'ok' : 'degraded',
    degradedReason,
    service: 'DatingAgent',
    version: BUILD_INFO.version,
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
    node: process.version,
    memory: {
      rssMb: roundMb(mem.rss),
      heapUsedMb: roundMb(mem.heapUsed),
      heapTotalMb: roundMb(mem.heapTotal),
    },
    llmConfigured,
    llmModel,
    frontend: {
      distPath: frontendDist,
      built: fs.existsSync(frontendDist),
      indexExists,
    },
    metrics: usageMetrics.snapshot(),
  };
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/**
 * P05 — extra diagnostics merged into the health payload only for
 * `GET /api/health?verbose=1` from a loopback client. The public payload
 * (`HealthReport`) is left untouched.
 */
export interface VerboseHealthReport {
  /** Free bytes on the filesystem holding the frontend dist; null when statfs is unavailable. */
  diskFreeBytes: number | null;
  /** Raw resident set size in bytes (the rounded MB `memory` block stays untouched). */
  rssBytes: number;
  /** Integer seconds since process start. */
  uptimeSeconds: number;
  /** Most recent 5xx under `/api/*` since process start; null when nothing failed. */
  lastError: LastApiError | null;
}

export function buildVerboseHealth(
  frontendDist: string,
  lastError: LastApiError | null,
): VerboseHealthReport {
  return {
    diskFreeBytes: diskFreeBytes(frontendDist),
    rssBytes: process.memoryUsage().rss,
    uptimeSeconds: Math.floor(process.uptime()),
    lastError,
  };
}

/** Free bytes for unprivileged users on the volume holding `target`. Never throws. */
function diskFreeBytes(target: string): number | null {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const stats = fs.statfsSync(target);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}
