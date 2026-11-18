import { describe, expect, it } from 'vitest';
import {
  coarseStatus,
  footerLevel,
  statusLabel,
  type HealthSnapshot,
} from '../src/lib/healthStatus';

const snap = (patch: Partial<HealthSnapshot>): HealthSnapshot => ({
  status: 'unknown',
  reachable: true,
  lastCheckedAt: null,
  ...patch,
});

describe('P27 · coarseStatus', () => {
  it('maps an ok payload to ok', () => {
    expect(coarseStatus({ status: 'ok', llmConfigured: true })).toBe('ok');
  });

  it('maps degraded payloads and anything unexpected to degraded', () => {
    expect(coarseStatus({ status: 'degraded' })).toBe('degraded');
    expect(coarseStatus({})).toBe('degraded');
    expect(coarseStatus({ status: 200 })).toBe('degraded');
    expect(coarseStatus(null)).toBe('degraded');
    expect(coarseStatus('ok')).toBe('degraded');
  });
});

describe('P27 · footerLevel / statusLabel', () => {
  it('is pending until the first poll completes', () => {
    const s = snap({});
    expect(footerLevel(s)).toBe('pending');
    expect(statusLabel(s)).toBe('检测中…');
  });

  it('is ok only when reachable with an ok status', () => {
    const s = snap({ status: 'ok', lastCheckedAt: 1 });
    expect(footerLevel(s)).toBe('ok');
    expect(statusLabel(s)).toBe('● 在线');
  });

  it('warns on a degraded payload', () => {
    const s = snap({ status: 'degraded', lastCheckedAt: 1 });
    expect(footerLevel(s)).toBe('warn');
    expect(statusLabel(s)).toBe('● 有点忙，稍等');
  });

  it('warns on fetch failure even when the last known status was ok', () => {
    const s = snap({ status: 'ok', reachable: false, lastCheckedAt: 2 });
    expect(footerLevel(s)).toBe('warn');
    expect(statusLabel(s)).toBe('暂时连不上，稍等再试');
  });
});
