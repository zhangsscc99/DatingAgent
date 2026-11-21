import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHealthReport } from '../src/lib/health.js';

const created: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-health-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildHealthReport', () => {
  it('reports degraded when the frontend dist has no index.html', () => {
    const dist = tmpDir();
    const report = buildHealthReport(dist, true);

    expect(report.status).toBe('degraded');
    expect(report.frontend.built).toBe(true);
    expect(report.frontend.indexExists).toBe(false);
    expect(report.llmConfigured).toBe(true);
    expect(report.service).toBe('DatingAgent');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.memory.rssMb).toBeGreaterThan(0);
  });

  it('reports degraded when the frontend was never built', () => {
    const dist = path.join(tmpDir(), 'missing-dist');
    const report = buildHealthReport(dist, false);

    expect(report.status).toBe('degraded');
    expect(report.frontend.built).toBe(false);
    expect(report.frontend.indexExists).toBe(false);
    expect(report.llmConfigured).toBe(false);
  });

  it('reports ok once index.html exists', () => {
    const dist = tmpDir();
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ok</title>');

    const report = buildHealthReport(dist, true);

    expect(report.status).toBe('ok');
    expect(report.degradedReason).toBeNull();
    expect(report.frontend.indexExists).toBe(true);
    expect(report.frontend.distPath).toBe(dist);
    expect(report.version).toMatch(/\S/);
  });

  it('reports degraded with reason llm when the LLM is not configured', () => {
    const dist = tmpDir();
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ok</title>');

    const report = buildHealthReport(dist, false);

    expect(report.status).toBe('degraded');
    expect(report.degradedReason).toBe('llm');
    expect(report.llmConfigured).toBe(false);
    expect(report.frontend.indexExists).toBe(true);
  });

  it('prefers frontend-dist over llm when both causes hit', () => {
    const dist = tmpDir();

    const report = buildHealthReport(dist, false);

    expect(report.status).toBe('degraded');
    expect(report.degradedReason).toBe('frontend-dist');
    expect(report.llmConfigured).toBe(false);
    expect(report.frontend.indexExists).toBe(false);
  });
});
