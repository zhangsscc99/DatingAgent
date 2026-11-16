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
    expect(formatWaitingLabel(12_000)).toBe('正在生成…（已等待 12 秒）');
  });

  it('leaves thinking and generating copy untouched', () => {
    expect(streamAnnouncement('thinking', 12_000, '关系建议')).toBe('正在思考…');
    expect(streamAnnouncement('generating', 12_000, '关系建议')).toBe(
      '正在生成…（已等待 12 秒）',
    );
    expect(streamAnnouncement('generating', 0)).toBe('正在生成…');
    expect(streamAnnouncement(undefined, 12_000, '关系建议')).toBe('');
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
      'buildStreamAnnouncement(streamingPhase, waitingElapsedMs, currentToolLabel)',
    );
    expect(app).toContain('toolPhaseLabel(currentToolLabel, waitingElapsedMs)');
  });
});
