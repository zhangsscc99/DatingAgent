/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  appendModelWaitHint,
  MODEL_WAIT_BOUND_HINT,
  MODEL_WAIT_BOUND_HINT_AFTER_MS,
  MODEL_WAIT_HINT,
  streamAnnouncement,
  SUMMARIZING_EXIT_HINT,
  toolPhaseLabel,
} from '../src/lib/streamAnnouncement';
import { formatWaitingLabel } from '../src/lib/thinkingTimer';
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

/**
 * P252 — the trailing wait clause used to read 「，在等模型开始写，最多再等一会儿」:
 * a comma glued to the full-width bracket, engineering vocabulary, and no
 * upper bound. The clause is now a human sentence after a full stop, and
 * the expectation converges: <15 s only the plain sentence, >=15 s a
 * concrete ceiling. Both wait surfaces (tool-phase label and the plain
 * generating label) share the same clause.
 */
describe('P252 · wait hint copy is human and bounded', () => {
  /** Every wait label a user can see, across both code paths. */
  const waitLabels = (ms: number): string[] => [
    appendModelWaitHint(formatWaitingLabel(ms), ms, undefined),
    appendModelWaitHint(toolPhaseLabel('聊天指导', ms, 'summarizing')!, ms, 'summarizing'),
    appendModelWaitHint(toolPhaseLabel('聊天指导', ms, 'calling')!, ms, 'calling'),
    toolPhaseLabel('聊天指导', ms, 'summarizing')!,
    appendModelWaitHint(
      streamAnnouncement('generating', ms, '聊天指导', 'summarizing'),
      ms,
      'summarizing',
    ),
  ];

  it('never uses engineering vocabulary', () => {
    for (const ms of [0, 5_000, 8_000, 12_000, 14_999, 15_000, 25_000, 45_000, 75_000]) {
      for (const text of waitLabels(ms)) {
        expect(text).not.toContain('模型');
        expect(text).not.toContain('开始写');
      }
    }
  });

  it('never glues a clause to the full-width bracket with a comma', () => {
    for (const ms of [0, 1_000, 8_000, 12_000, 14_999, 15_000, 19_999, 20_000, 25_000, 61_000, 75_000]) {
      for (const text of waitLabels(ms)) {
        expect(text).not.toContain('），');
      }
    }
  });

  it('under 15 s the clause has no upper bound, at >=15 s it names a concrete ceiling', () => {
    expect(MODEL_WAIT_BOUND_HINT_AFTER_MS).toBe(15_000);
    for (const ms of [8_000, 12_000, MODEL_WAIT_BOUND_HINT_AFTER_MS - 1]) {
      for (const text of [
        appendModelWaitHint(formatWaitingLabel(ms), ms, undefined),
        appendModelWaitHint(toolPhaseLabel('聊天指导', ms, 'summarizing')!, ms, 'summarizing'),
      ]) {
        expect(text).toContain(MODEL_WAIT_HINT);
        expect(text).not.toContain(MODEL_WAIT_BOUND_HINT);
        expect(text).not.toContain('最多再等');
      }
    }
    for (const ms of [MODEL_WAIT_BOUND_HINT_AFTER_MS, 19_999]) {
      for (const text of [
        appendModelWaitHint(formatWaitingLabel(ms), ms, undefined),
        appendModelWaitHint(toolPhaseLabel('聊天指导', ms, 'summarizing')!, ms, 'summarizing'),
      ]) {
        expect(text).toContain(MODEL_WAIT_BOUND_HINT);
      }
    }
  });

  it('both wait surfaces read the same clause', () => {
    const toolSide = appendModelWaitHint(
      toolPhaseLabel('聊天指导', 9_000, 'summarizing')!,
      9_000,
      'summarizing',
    );
    const plainSide = appendModelWaitHint(formatWaitingLabel(9_000), 9_000, undefined);
    expect(toolSide).toBe('正在整理「聊天指导」的建议…（已等待 9 秒）。' + MODEL_WAIT_HINT);
    expect(plainSide).toBe('正在生成…（已等待 9 秒）。' + MODEL_WAIT_HINT);
    const toolBound = appendModelWaitHint(
      toolPhaseLabel('聊天指导', 16_000, 'summarizing')!,
      16_000,
      'summarizing',
    );
    const plainBound = appendModelWaitHint(formatWaitingLabel(16_000), 16_000, undefined);
    expect(toolBound).toContain(MODEL_WAIT_BOUND_HINT);
    expect(plainBound).toContain(MODEL_WAIT_BOUND_HINT);
    expect(toolBound.slice(toolBound.indexOf('。'))).toBe(
      plainBound.slice(plainBound.indexOf('。')),
    );
  });

  it('the >=20 s exit hint appears exactly once and never stacks with the 15 s bound', () => {
    for (const ms of [20_000, 25_000, 45_000, 75_000]) {
      const base = toolPhaseLabel('约会规划', ms, 'summarizing')!;
      expect(base).toContain(SUMMARIZING_EXIT_HINT);
      const text = appendModelWaitHint(base, ms, 'summarizing');
      expect(text.split(SUMMARIZING_EXIT_HINT).length - 1).toBe(1);
      expect(text).not.toContain(MODEL_WAIT_BOUND_HINT);
      expect(text).not.toContain('还在等回复开始');
      // Same through the aria-live surface.
      const announced = appendModelWaitHint(
        streamAnnouncement('generating', ms, '约会规划', 'summarizing'),
        ms,
        'summarizing',
      );
      expect(announced.split(SUMMARIZING_EXIT_HINT).length - 1).toBe(1);
      expect(announced).not.toContain(MODEL_WAIT_BOUND_HINT);
    }
  });
});
