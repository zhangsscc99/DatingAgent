/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  appendModelWaitHint,
  MODEL_WAIT_HINT,
  MODEL_WAIT_HINT_AFTER_MS,
  toolPhaseLabel,
} from '../src/lib/streamAnnouncement';
import { formatWaitingLabel } from '../src/lib/thinkingTimer';
import { toolDisplayName } from '../src/lib/toolLabels';

/**
 * P240 — a tool-routed turn used to show only the generic stopwatch
 * 「正在生成…（已等待 N 秒）」 for the whole pre-first-token window, so a
 * 13 s wait read exactly like a hang. The wait copy now: (a) names the
 * tool as soon as `tool_start` arrives, (b) returns to the generic
 * generating label once the first body delta lands, and (c) past 8 s
 * without a first token gains a 「还在等回复开始…」 clause
 * that disappears with the first token.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P240 · named wait phase before the first token', () => {
  it('(a) after tool_start the wait copy names the tool in Chinese and keeps the seconds ticking', () => {
    // The wait label resolves the badge's tool id through the P239 map…
    const label = toolDisplayName('coach_conversation');
    expect(label).toBe('接话术');
    // …and the named phase copy carries both the name and the waited seconds.
    const copy = toolPhaseLabel(label, 9_000, 'calling');
    expect(copy).toContain('接话术');
    expect(copy).toContain('已等待 9 秒');
    expect(copy).toBe('正在调用「接话术」…（已等待 9 秒）');
    // Still ticking second by second.
    expect(toolPhaseLabel(label, 10_000, 'calling')).toContain('已等待 10 秒');
  });

  it('(a) an unmapped tool id never leaks the raw id into the wait copy', () => {
    expect(toolDisplayName('mystery_tool')).toBeUndefined();
    // No Chinese label → toolPhaseLabel abstains → generic elapsed copy.
    expect(toolPhaseLabel(toolDisplayName('mystery_tool'), 9_000, 'calling')).toBeUndefined();
    expect(toolPhaseLabel(undefined, 9_000, 'calling')).toBeUndefined();
    // The App resolves the wait label via toolDisplayName, not the badge's
    // `?? d.name` raw-id fallback.
    const app = read('App.tsx');
    expect(app).toContain('toolDisplayName(runningToolName)');
    expect(app).toContain('toolPhaseLabel(currentToolLabel, waitingElapsedMs, streamingToolPhase)');
  });

  it('(b) the first body delta clears the tool phase so the copy returns to 正在生成', () => {
    const app = read('App.tsx');
    // Both the delta and the authoritative message branch drop toolPhase…
    expect(app).toContain(
      'patchAssistant({ content: finalContent, streamPhase, streaming: true, toolPhase })',
    );
    expect(app).toContain('toolPhase = undefined');
    // …and with no tool phase left, the wait copy is the generic staged
    // label again: 「正在生成…（已等待 N 秒）」 under 10 s.
    expect(formatWaitingLabel(5_000)).toBe('正在生成…（已等待 5 秒）');
  });

  it('(c) past 8 s without a first token the copy gains the model-wait clause', () => {
    const base = formatWaitingLabel(8_500);
    const hinted = appendModelWaitHint(base, 8_500, undefined);
    expect(hinted).toBe(`${base}。${MODEL_WAIT_HINT}`);
    expect(hinted).toContain('还在等回复开始');
    expect(appendModelWaitHint(formatWaitingLabel(9_000), 9_000, 'summarizing')).toContain(
      MODEL_WAIT_HINT,
    );
    // Boundary: strictly before 8 s there is no clause.
    expect(appendModelWaitHint(formatWaitingLabel(7_999), 7_999, undefined)).not.toContain(
      MODEL_WAIT_HINT,
    );
    expect(MODEL_WAIT_HINT_AFTER_MS).toBe(8_000);
    // While a tool call is still running the named label already explains
    // the wait — no contradictory 「还在等回复开始」.
    const calling = toolPhaseLabel('接话术', 12_000, 'calling')!;
    expect(appendModelWaitHint(calling, 12_000, 'calling')).toBe(calling);
    // Empty/undefined-ish labels pass through untouched.
    expect(appendModelWaitHint('', 30_000, undefined)).toBe('');
  });

  it('(c) the hint lives behind waitingForFirstToken, so it disappears with the first token', () => {
    const app = read('App.tsx');
    // waitingForFirstToken is only true while no streaming bubble has
    // content — the first delta flips it and drops the whole wait label,
    // hint included.
    expect(app).toContain('waitingForFirstToken');
    expect(app).toContain('appendModelWaitHint(');
    // The aria-live announcement gets the same treatment.
    expect(app).toContain(
      'appendModelWaitHint(\n    buildStreamAnnouncement(',
    );
  });
});
