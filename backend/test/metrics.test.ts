import { describe, expect, it } from 'vitest';
import { UsageMetrics } from '../src/lib/metrics.js';

describe('UsageMetrics', () => {
  it('starts at zero', () => {
    const snapshot = new UsageMetrics().snapshot();

    expect(snapshot.requests).toEqual({ total: 0, chat: 0, chatErrors: 0 });
    expect(snapshot.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
    expect(snapshot.latency).toEqual({ chatSamples: 0, avgMs: 0, lastMs: 0, maxMs: 0 });
    expect(snapshot.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('counts every request and chat outcomes separately', () => {
    const metrics = new UsageMetrics();
    metrics.recordRequest();
    metrics.recordRequest();
    metrics.recordChat(120, true);
    metrics.recordChat(80, false);

    const { requests, latency } = metrics.snapshot();
    expect(requests).toEqual({ total: 2, chat: 2, chatErrors: 1 });
    expect(latency.chatSamples).toBe(2);
    expect(latency.avgMs).toBe(100);
    expect(latency.lastMs).toBe(80);
    expect(latency.maxMs).toBe(120);
  });

  it('sums provider token usage and ignores malformed values', () => {
    const metrics = new UsageMetrics();
    metrics.recordTokens(100, 40);
    metrics.recordTokens(5, 1);
    metrics.recordTokens(Number.NaN, -3);

    expect(metrics.snapshot().tokens).toEqual({ prompt: 105, completion: 41, total: 146 });
  });
});
