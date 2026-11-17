import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveGitSha } from '../src/lib/git-sha.js';

afterEach(() => {
  vi.doUnmock('../src/generated/build-info.js');
  vi.resetModules();
});

describe('resolveGitSha — source priority (P236)', () => {
  it('env var wins over repo HEAD and the baked file', () => {
    const r = resolveGitSha({ envSha: 'eee9999', readHead: () => 'aaa1111', bakedSha: 'bbb2222' });
    expect(r).toEqual({ sha: 'eee9999', source: 'env' });
  });

  it('repo HEAD read at process start wins over the baked file', () => {
    const r = resolveGitSha({ readHead: () => 'ccc3333', bakedSha: 'bbb2222' });
    expect(r).toEqual({ sha: 'ccc3333', source: 'repo' });
  });

  it('repo HEAD wins even when the baked sha lags one commit behind', () => {
    // P236 regression: ci-deploy baked 25585ad, the loop then committed 4068713.
    const r = resolveGitSha({ readHead: () => '4068713', bakedSha: '25585ad' });
    expect(r.sha).toBe('4068713');
    expect(r.source).toBe('repo');
  });

  it('falls back to the baked file when there is no env and no repo', () => {
    const r = resolveGitSha({ readHead: () => null, bakedSha: 'bbb2222' });
    expect(r).toEqual({ sha: 'bbb2222', source: 'build' });
  });

  it('ignores an invalid env sha and falls through to repo HEAD', () => {
    const r = resolveGitSha({ envSha: 'not-a-sha', readHead: () => 'ccc3333', bakedSha: 'bbb2222' });
    expect(r).toEqual({ sha: 'ccc3333', source: 'repo' });
  });

  it('survives a throwing readHead and still uses the baked file', () => {
    const r = resolveGitSha({
      readHead: () => {
        throw new Error('git missing');
      },
      bakedSha: 'bbb2222',
    });
    expect(r).toEqual({ sha: 'bbb2222', source: 'build' });
  });

  it('reports the literal "unknown" when nothing resolves — loud mismatch signal', () => {
    const r = resolveGitSha({ readHead: () => null, bakedSha: 'unknown' });
    expect(r.sha).toBe('unknown');
    expect(r.source).toBe('unknown');
    // "unknown" can never equal `git rev-parse --short HEAD`, so
    // scripts/refresh-version.sh exits non-zero instead of serving a stale sha.
    expect(r.sha).not.toMatch(/^[0-9a-f]{7,40}$/i);
  });
});

describe('buildVersionReport', () => {
  it('returns a complete report when build info is present', async () => {
    const { buildVersionReport } = await import('../src/lib/version.js');
    const report = buildVersionReport();

    expect(report.version).toMatch(/\S/);
    expect(report.gitSha).toMatch(/\S/);
    expect(['env', 'repo', 'build', 'unknown']).toContain(report.shaSource);
    expect(report.buildTime).toMatch(/\S/);
    expect(report.node).toBe(process.version);
  });

  it('degrades to "unknown" instead of throwing when build info is missing', async () => {
    vi.resetModules();
    vi.doMock('../src/generated/build-info.js', () => {
      throw new Error('generated build-info module is unavailable');
    });

    const { buildVersionReport } = await import('../src/lib/version.js');
    const report = buildVersionReport();

    expect(report.version).toBe('unknown');
    expect(report.buildTime).toBe('unknown');
    expect(report.gitSha).toMatch(/\S/);
    expect(report.node).toBe(process.version);
  });
});
