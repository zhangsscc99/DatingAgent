import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHealthReport, buildVerboseHealth } from '../src/lib/health.js';
import { LastApiErrorRecorder } from '../src/lib/last-error.js';

const created: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-health-verbose-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('P05 verbose health probe', () => {
  it('keeps the public payload free of a verbose key', () => {
    const dist = tmpDir();
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ok</title>');

    const report = buildHealthReport(dist, true);

    expect(report.status).toBe('ok');
    expect(report).not.toHaveProperty('verbose');
  });

  it('returns disk-free, rss, uptime and last-error fields', () => {
    const dist = tmpDir();

    const verbose = buildVerboseHealth(dist, null);

    // statfs may be unavailable on some platforms: byte count or null, never a throw.
    if (verbose.diskFreeBytes !== null) {
      expect(verbose.diskFreeBytes).toBeGreaterThan(0);
    }
    expect(Number.isInteger(verbose.rssBytes)).toBe(true);
    expect(verbose.rssBytes).toBeGreaterThan(0);
    expect(Number.isInteger(verbose.uptimeSeconds)).toBe(true);
    expect(verbose.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(verbose.lastError).toBeNull();
  });

  it('passes a recorded last error through to the verbose report', () => {
    const dist = tmpDir();
    const entry = {
      ts: new Date().toISOString(),
      path: '/api/chat',
      status: 500,
      method: 'POST',
    };

    expect(buildVerboseHealth(dist, entry).lastError).toEqual(entry);
  });
});

describe('LastApiErrorRecorder', () => {
  it('round-trips the most recent recorded error', () => {
    const recorder = new LastApiErrorRecorder();
    expect(recorder.latest()).toBeNull();

    const first = {
      ts: new Date().toISOString(),
      path: '/api/chat',
      status: 500,
      method: 'POST',
    };
    recorder.record(first);
    expect(recorder.latest()).toEqual(first);

    const newer = { ...first, ts: new Date().toISOString(), status: 502 };
    recorder.record(newer);
    expect(recorder.latest()).toEqual(newer);
  });
});
