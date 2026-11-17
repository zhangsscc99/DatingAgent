/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { streamAnnouncement } from '../src/lib/streamAnnouncement';
import type { StreamPhase } from '../src/types';

/**
 * P198 — the aria-live announcement used to read 「正在生成…正在生成回复」
 * because the `正在生成…` prefix was glued onto a phase label that itself
 * started with 正在生成. The helper must keep each phase distinct, never
 * double the phrase, and surface the waited seconds while generating.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const PHASES: StreamPhase[] = ['thinking', 'tool', 'generating'];

describe('P198 · streamAnnouncement copy', () => {
  it('announces nothing when no stream is in flight', () => {
    expect(streamAnnouncement(undefined, 0)).toBe('');
    expect(streamAnnouncement(undefined, 8000)).toBe('');
  });

  it('never contains the doubled phrase in any phase', () => {
    for (const phase of PHASES) {
      for (const ms of [0, 8000, 75_000]) {
        const text = streamAnnouncement(phase, ms);
        expect(text).not.toContain('正在生成…正在生成');
        expect(text.split('正在生成').length - 1).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps each phase distinguishable', () => {
    const outputs = PHASES.map((phase) => streamAnnouncement(phase, 8000));
    expect(new Set(outputs).size).toBe(PHASES.length);
    expect(streamAnnouncement('thinking', 8000)).toBe('正在思考…');
    expect(streamAnnouncement('tool', 8000)).toBe('正在调用工具…');
  });

  it('generating announces the waited seconds', () => {
    expect(streamAnnouncement('generating', 8000)).toContain('已等待 8 秒');
    expect(streamAnnouncement('generating', 8000)).toBe('正在生成…（已等待 8 秒）');
    expect(streamAnnouncement('generating', 0)).toBe('正在生成…');
  });

  it('generating follows the staged waiting copy past 10 s', () => {
    expect(streamAnnouncement('generating', 12_000)).toBe(
      '正在组织回复…（已等待 12 秒）',
    );
    expect(streamAnnouncement('generating', 31_000)).toContain('仍在生成');
    expect(streamAnnouncement('generating', 31_000)).toContain('已等待 31 秒');
    // The tool phase keeps its own copy and is never swallowed by the
    // staged buckets.
    expect(streamAnnouncement('tool', 31_000, '关系建议')).toBe(
      '正在调用「关系建议」…（已等待 31 秒）',
    );
  });

  it('App.tsx wires the helper with the existing waiting ticker state', () => {
    const app = read('App.tsx');
    expect(app).toContain("from './lib/streamAnnouncement'");
    expect(app).toContain('buildStreamAnnouncement(streamingPhase, waitingElapsedMs');
    expect(app).not.toContain('`正在生成…${STREAM_PHASE_LABELS');
  });
});
