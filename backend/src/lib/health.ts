import fs from 'node:fs';
import path from 'node:path';
import { serverStartedAt } from '../config/runtime.js';
import { BUILD_INFO } from '../generated/build-info.js';
import { usageMetrics, type MetricsSnapshot } from './metrics.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
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
  const mem = process.memoryUsage();

  return {
    status: indexExists ? 'ok' : 'degraded',
    service: 'DatingAgent',
    version: BUILD_INFO.version,
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
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
