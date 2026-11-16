import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../src/generated/build-info.js');
  vi.resetModules();
});

describe('buildVersionReport', () => {
  it('returns a complete report when build info is present', async () => {
    const { buildVersionReport } = await import('../src/lib/version.js');
    const report = buildVersionReport();

    expect(report.version).toMatch(/\S/);
    expect(report.gitSha).toMatch(/\S/);
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
