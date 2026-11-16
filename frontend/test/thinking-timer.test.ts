/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatWaitingLabel,
  startWaitingTicker,
  tickIntervalMs,
} from '../src/lib/thinkingTimer';

/**
 * P192 — the pre-first-token window (measured 6–16 s in walkthroughs) used
 * to show a frozen 「正在生成回复」, indistinguishable from a hung request.
 * The fix is a once-a-second elapsed label on the streaming placeholder.
 * The label rule and the ticker lifecycle live in lib/thinkingTimer.ts so
 * they are testable with fake timers; the last block keeps source-level
 * guards on the App/ChatWindow/MessageBubble wiring (there is no DOM
 * harness in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

describe('P192 · formatWaitingLabel buckets', () => {
  it('under one second reads as thinking', () => {
    expect(formatWaitingLabel(0)).toBe('正在思考…');
    expect(formatWaitingLabel(999)).toBe('正在思考…');
  });

  it('from 1 s to just under a minute counts whole seconds', () => {
    expect(formatWaitingLabel(1000)).toBe('正在生成…（已等待 1 秒）');
    expect(formatWaitingLabel(59_999)).toBe('正在生成…（已等待 59 秒）');
  });

  it('a minute and beyond reads 分 + 秒', () => {
    expect(formatWaitingLabel(60_000)).toBe('正在生成…（已等待 1 分 0 秒）');
    expect(formatWaitingLabel(3_600_000)).toBe('正在生成…（已等待 60 分 0 秒）');
  });
});

describe('P192 · ticker cadence and lifecycle', () => {
  it('ticks once per second', () => {
    expect(tickIntervalMs()).toBe(1000);
  });

  it('fires on the cadence until stopped, then never updates again (unmount-safe)', () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    let elapsed = 0;
    const ticker = startWaitingTicker(() => {
      elapsed += tickIntervalMs();
      ticks.push(elapsed);
    });

    vi.advanceTimersByTime(3_500);
    expect(ticks).toEqual([1000, 2000, 3000]);

    // What the App effect cleanup runs on first delta / done / error /
    // abort / unmount — a stopped ticker must not touch state again.
    ticker.stop();
    vi.advanceTimersByTime(10_000);
    expect(ticks).toEqual([1000, 2000, 3000]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('P192 · wiring guards', () => {
  it('App ticks the counter only while loading with an empty stream bubble', () => {
    const app = read('App.tsx');
    expect(app).toContain('startWaitingTicker');
    expect(app).toContain('formatWaitingLabel(waitingElapsedMs)');
    expect(app).toContain('waitingLabel={waitingLabel}');
    // Gated on the reply being in flight with nothing streamed yet.
    expect(app).toContain('waitingForFirstToken');
    expect(app).toContain('m.streaming && m.content');
  });

  it('the ticking label reaches the placeholder through ChatWindow and MessageBubble', () => {
    const win = read('components/ChatWindow.tsx');
    expect(win).toContain('waitingLabel');
    const bubble = read('components/MessageBubble.tsx');
    expect(bubble).toContain('label={waitingLabel}');
    const indicator = read('components/StreamingIndicator.tsx');
    expect(indicator).toContain('label ?? PHASE_LABELS[phase]');
  });

  it('the per-second number stays out of the polite live region', () => {
    // The indicator is aria-hidden, and App's polite announcement still
    // carries only the phase-level streamAnnouncement.
    const indicator = read('components/StreamingIndicator.tsx');
    expect(indicator).toContain('aria-hidden="true"');
    const app = read('App.tsx');
    expect(app).toContain('{streamAnnouncement}');
    // The polite span's content is the phase announcement, not the counter.
    expect(app).not.toContain('aria-live="polite">\n        {waitingLabel}');
  });

  it('the placeholder reserves the same vertical space as before', () => {
    const css = read('components/StreamingIndicator.css');
    expect(css).toContain('min-height: 20px');
  });
});
