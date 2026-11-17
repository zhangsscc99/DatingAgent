/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_PROGRESS_ORGANIZING,
  generationProgressLabel,
} from '../src/lib/generationProgress';

/**
 * P272 — during a long reply the bubble offered only 「停止生成」 and no
 * quantitative signal that text was arriving. The pending bubble now shows
 * 「正在组织答案」 before the first token and 「已生成 N 字」 while content
 * streams; the line disappears the moment the turn settles. There is no DOM
 * harness in this repo, so the last block keeps source-level guards on the
 * MessageBubble/StreamingIndicator wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P272 · generationProgressLabel copy', () => {
  it('pending with empty content renders 「正在组织答案」', () => {
    expect(generationProgressLabel(0, true)).toBe('正在组织答案');
    expect(GENERATION_PROGRESS_ORGANIZING).toBe('正在组织答案');
  });

  it('a stream of 12 characters renders 「已生成 12 字」', () => {
    expect(generationProgressLabel(12, true)).toBe('已生成 12 字');
  });

  it('counts grow with the streamed content', () => {
    expect(generationProgressLabel(1, true)).toBe('已生成 1 字');
    expect(generationProgressLabel(500, true)).toBe('已生成 500 字');
  });

  it('after completion nothing is rendered', () => {
    expect(generationProgressLabel(0, false)).toBeUndefined();
    expect(generationProgressLabel(12, false)).toBeUndefined();
  });
});

describe('P272 · wiring guards', () => {
  const bubble = read('components/MessageBubble.tsx');

  it('the bubble derives the label from streaming state + content length', () => {
    expect(bubble).toContain('generationProgressLabel(message.content.length');
    expect(bubble).toContain('!!message.streaming');
  });

  it('the counter line only exists while streaming with content', () => {
    expect(bubble).toContain('className="generation-progress"');
    expect(bubble).toContain('progressLabel && message.content.length > 0');
  });

  it('the empty-content placeholder folds progress into the single label slot', () => {
    // 正在组织答案 reaches the StreamingIndicator label — no second
    // overlapping thinking text is rendered beside it.
    expect(bubble).toContain('waitingLabel && progressLabel');
    expect(bubble).toContain('progressLabel ?? waitingLabel');
  });

  it('the per-token counter stays out of the polite live region', () => {
    const div = bubble.slice(
      bubble.indexOf('className="generation-progress"') - 40,
      bubble.indexOf('className="generation-progress"') + 60,
    );
    expect(div).toContain('aria-hidden="true"');
  });
});
