/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { streamAnnouncement, toolPhaseLabel } from '../src/lib/streamAnnouncement';
import { formatWaitingLabel } from '../src/lib/thinkingTimer';

/**
 * P210 — during the tool phase the wait copy used to be a bare ticking
 * timer; the user couldn't tell which of the three serialized tool calls
 * was running. The copy now names the tool (via the same TOOL_LABELS map
 * the badges use) and keeps the elapsed seconds ticking.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P210 · tool-phase progress copy', () => {
  it('names the running tool with its mapped Chinese label and keeps the seconds ticking', () => {
    expect(streamAnnouncement('tool', 12_000, '关系建议')).toBe('正在调用:关系建议…（已等待 12 秒）');
    expect(streamAnnouncement('tool', 12_000, '约会规划')).toContain('约会规划');
    expect(streamAnnouncement('tool', 8_000, '聊天指导')).toContain('已等待 8 秒');
    // Still ticking second by second.
    expect(streamAnnouncement('tool', 12_000, '关系建议')).not.toBe(
      streamAnnouncement('tool', 13_000, '关系建议'),
    );
    expect(streamAnnouncement('tool', 13_000, '关系建议')).toContain('已等待 13 秒');
    // Sub-second: name shows, seconds not yet.
    expect(streamAnnouncement('tool', 500, '关系建议')).toBe('正在调用:关系建议…');
    // Past a minute the format matches formatWaitingLabel's 分/秒 shape.
    expect(streamAnnouncement('tool', 75_000, '关系建议')).toBe(
      '正在调用:关系建议…（已等待 1 分 15 秒）',
    );
  });

  it('falls back to the previous copy when no tool name is known', () => {
    expect(streamAnnouncement('tool', 12_000)).toBe('正在调用工具…');
    expect(streamAnnouncement('tool', 12_000, undefined)).toBe('正在调用工具…');
    expect(streamAnnouncement('tool', 12_000, '')).toBe('正在调用工具…');
    // The bubble's visible label keeps the P192 ticking copy instead.
    expect(toolPhaseLabel(undefined, 12_000)).toBeUndefined();
    expect(toolPhaseLabel('', 12_000)).toBeUndefined();
    expect(formatWaitingLabel(12_000)).toBe('正在组织回复…（已等待 12 秒）');
  });

  it('leaves thinking fixed and generating on the staged waiting label', () => {
    expect(streamAnnouncement('thinking', 12_000, '关系建议')).toBe('正在思考…');
    expect(streamAnnouncement('generating', 12_000, '关系建议')).toBe(
      '正在组织回复…（已等待 12 秒）',
    );
    expect(streamAnnouncement('generating', 0)).toBe('正在生成…');
    expect(streamAnnouncement(undefined, 12_000, '关系建议')).toBe('');
  });

  it('P231: the summarizing phase keeps naming the tool with ticking seconds', () => {
    // After tool_end the reply is still being written — the label says which
    // tool's result is being organised and keeps counting elapsed seconds.
    expect(toolPhaseLabel('关系建议', 12_000, 'summarizing')).toBe(
      '正在整理:关系建议的结果…（已等待 12 秒）',
    );
    expect(toolPhaseLabel('关系建议', 500, 'summarizing')).toBe('正在整理:关系建议的结果…');
    expect(toolPhaseLabel('关系建议', 75_000, 'summarizing')).toBe(
      '正在整理:关系建议的结果…（已等待 1 分 15 秒）',
    );
    // 'tool' stream phase carrying a summarizing tool phase uses it too.
    expect(streamAnnouncement('tool', 8_000, '约会规划', 'summarizing')).toBe(
      '正在整理:约会规划的结果…（已等待 8 秒）',
    );
    // Even after the stream phase flips to 'generating', the post-tool wait
    // keeps naming the tool instead of falling back to the generic copy.
    expect(streamAnnouncement('generating', 20_000, '关系建议', 'summarizing')).toBe(
      '正在整理:关系建议的结果…（已等待 20 秒）',
    );
    // Ticks second by second and never doubles the 正在生成 prefix.
    expect(streamAnnouncement('generating', 20_000, '关系建议', 'summarizing')).not.toBe(
      streamAnnouncement('generating', 21_000, '关系建议', 'summarizing'),
    );
    expect(streamAnnouncement('tool', 12_000, '关系建议', 'summarizing')).not.toContain(
      '正在生成',
    );
    // No tool name → previous fallbacks still apply.
    expect(streamAnnouncement('generating', 12_000, undefined, 'summarizing')).toBe(
      '正在组织回复…（已等待 12 秒）',
    );
    expect(toolPhaseLabel(undefined, 12_000, 'summarizing')).toBeUndefined();
  });

  it('never doubles the 正在生成 prefix', () => {
    for (const ms of [0, 12_000, 75_000]) {
      const text = streamAnnouncement('tool', ms, '关系建议');
      expect(text).not.toContain('正在生成');
    }
  });

  it('App.tsx feeds the running tool label from tool_start into both surfaces', () => {
    const app = read('App.tsx');
    // Same TOOL_LABELS map that fills the badges' toolEvents labels.
    expect(app).toContain('TOOL_LABELS[d.name] ?? d.name');
    expect(app).toContain("status === 'running'");
    // The aria-live announcement and the bubble waiting label both get it.
    expect(app).toContain(
      'buildStreamAnnouncement(streamingPhase, waitingElapsedMs, currentToolLabel, streamingToolPhase)',
    );
    expect(app).toContain('toolPhaseLabel(currentToolLabel, waitingElapsedMs, streamingToolPhase)');
  });

  it('P231: tool_progress events are parsed and handled in the read loop', () => {
    const app = read('App.tsx');
    const sse = read('lib/sse.ts');
    // The new backend event survives the SSE whitelist…
    expect(sse).toContain("'tool_progress'");
    // …and the read loop reacts to it: sets the tool phase, keeps the badge.
    expect(app).toContain("event.type === 'tool_progress'");
    expect(app).toContain("d.phase === 'summarizing' ? 'summarizing' : 'calling'");
    // tool_start no longer pushes a duplicate badge after an early announce.
    expect(app).toContain('toolEvents.find((t) => t.name === d.name)');
    // The post-tool window is covered: tool_end marks allDone as summarizing.
    expect(app).toContain("toolPhase = allDone ? 'summarizing' : 'calling'");
  });
});
