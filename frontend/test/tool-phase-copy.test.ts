/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  streamAnnouncement,
  SUMMARIZING_EXIT_HINT,
  SUMMARIZING_EXIT_HINT_AFTER_MS,
  toolPhaseLabel,
} from '../src/lib/streamAnnouncement';
import type { ToolPhaseKind } from '../src/types';

/**
 * P248 — the tool-phase wait copy used to read like a system log:
 * 「正在整理:接话术的结果…（已等待 6 秒）」 — a half-width colon plus a
 * noun-shaped 「…的结果」, and the seconds kept climbing past 19 s with
 * no exit hint. The copy now quotes the tool name with 「」, uses verb
 * phrases, and past 20 s of summarizing tells the user the reply will
 * stay put so they can switch away.
 */

const LABELS = ['关系建议', '接话术', '排约会'];
const PHASES: ToolPhaseKind[] = ['calling', 'summarizing'];
const ELAPSED = [0, 500, 1_000, 12_000, 19_999, 20_000, 45_000, 75_000];

describe('P248 · tool-phase copy punctuation and exit hint', () => {
  it('never uses a half-width colon or the 「的结果…」 noun phrase', () => {
    for (const phase of PHASES) {
      for (const label of LABELS) {
        for (const ms of ELAPSED) {
          const text = toolPhaseLabel(label, ms, phase)!;
          expect(text).not.toContain(':');
          expect(text).not.toContain('的结果…');
          expect(text).not.toContain('的结果');
        }
      }
    }
  });

  it('quotes the tool name with 「」 and uses verb phrases', () => {
    expect(toolPhaseLabel('接话术', 6_000, 'calling')).toBe(
      '正在调用「接话术」…（已等待 6 秒）',
    );
    expect(toolPhaseLabel('接话术', 6_000, 'summarizing')).toBe(
      '正在整理「接话术」的建议…（已等待 6 秒）',
    );
    // The full announcement path (bubble + aria-live) carries the same copy.
    expect(streamAnnouncement('tool', 6_000, '接话术')).toContain('正在调用「接话术」');
    expect(streamAnnouncement('generating', 6_000, '接话术', 'summarizing')).toContain(
      '正在整理「接话术」',
    );
  });

  it('summarizing appends the exit hint at >=20 s and never before', () => {
    expect(SUMMARIZING_EXIT_HINT_AFTER_MS).toBe(20_000);
    // At and past the threshold the hint is appended to the ticking label.
    for (const ms of [20_000, 30_000, 61_000]) {
      const text = toolPhaseLabel('关系建议', ms, 'summarizing')!;
      expect(text).toContain(SUMMARIZING_EXIT_HINT);
      expect(text).toContain('已等待');
    }
    // Strictly under the threshold there is no hint at any bucket.
    for (const ms of [0, 500, 1_000, 8_000, 19_999]) {
      expect(toolPhaseLabel('关系建议', ms, 'summarizing')).not.toContain(
        SUMMARIZING_EXIT_HINT,
      );
    }
    // The 'calling' phase keeps the P240 copy — no exit hint even past a
    // minute (its named label already says what is being waited on).
    for (const ms of [20_000, 45_000, 75_000]) {
      expect(toolPhaseLabel('关系建议', ms, 'calling')).not.toContain(
        SUMMARIZING_EXIT_HINT,
      );
    }
  });

  it('the exit hint flows through streamAnnouncement in the summarizing window', () => {
    expect(streamAnnouncement('generating', 25_000, '排约会', 'summarizing')).toBe(
      `正在整理「排约会」的建议…（已等待 25 秒）。${SUMMARIZING_EXIT_HINT}`,
    );
    expect(streamAnnouncement('tool', 25_000, '排约会', 'summarizing')).toContain(
      SUMMARIZING_EXIT_HINT,
    );
    // Below the threshold the announcement is hint-free…
    expect(
      streamAnnouncement('generating', 19_999, '排约会', 'summarizing'),
    ).not.toContain(SUMMARIZING_EXIT_HINT);
    // …and a calling tool phase never gains it.
    expect(streamAnnouncement('tool', 25_000, '排约会', 'calling')).not.toContain(
      SUMMARIZING_EXIT_HINT,
    );
    // Unknown tool: fallback copy unchanged, still hint-free.
    expect(streamAnnouncement('generating', 25_000, undefined, 'summarizing')).not.toContain(
      SUMMARIZING_EXIT_HINT,
    );
  });
});
