import fs from 'node:fs';
import path from 'node:path';
import { serverStartedAt } from '../config/runtime.js';

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
  frontend: {
    distPath: string;
    built: boolean;
    indexExists: boolean;
  };
}

export function buildHealthReport(frontendDist: string, llmConfigured: boolean): HealthReport {
  const indexPath = path.join(frontendDist, 'index.html');
  const indexExists = fs.existsSync(indexPath);
  const mem = process.memoryUsage();

  return {
    status: indexExists ? 'ok' : 'degraded',
    service: 'DatingAgent',
    version: '1.0.0',
    uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
    memory: {
      rssMb: roundMb(mem.rss),
      heapUsedMb: roundMb(mem.heapUsed),
      heapTotalMb: roundMb(mem.heapTotal),
    },
    llmConfigured,
    frontend: {
      distPath: frontendDist,
      built: fs.existsSync(frontendDist),
      indexExists,
    },
  };
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
