/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_PROGRESS_ORGANIZING,
  generationProgressLabel,
} from '../src/lib/generationProgress';
import * as sendQueue from '../src/lib/sendQueue';
import { queueHintText } from '../src/lib/sendQueue';

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

describe('P300 · progress visible from the first pending second', () => {
  const app = read('App.tsx');
  const bubble = read('components/MessageBubble.tsx');

  it('the send path mounts a streaming thinking placeholder synchronously', () => {
    // runSend appends the pending bubble before the fetch starts, so the
    // progress label is on screen at t≈0 — not after the first SSE event.
    expect(app).toContain('streaming: true');
    expect(app).toContain("streamPhase: 'thinking'");
  });

  it('the progress label needs no waiting timer — it renders at t=0', () => {
    // waitingLabel may be undefined on the very first frame; progressLabel
    // alone still feeds the indicator slot.
    expect(bubble).toContain('progressLabel ?? waitingLabel');
    expect(generationProgressLabel(0, true)).toBe('正在组织答案');
  });

  it('the counter keeps updating as characters stream in', () => {
    const counts = [1, 12, 37, 38, 500].map((n) => generationProgressLabel(n, true));
    expect(counts).toEqual([
      '已生成 1 字',
      '已生成 12 字',
      '已生成 37 字',
      '已生成 38 字',
      '已生成 500 字',
    ]);
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

describe('P310 · composer hint only acknowledges real queued drafts', () => {
  const bar = read('components/InputBar.tsx');
  const sendQueueSrc = read('lib/sendQueue.ts');

  it('the empty-queue composer copy is empty', () => {
    expect(queueHintText(0)).toBe('');
  });

  it('the queued copy names the count and never says 「自动发送」', () => {
    for (const n of [1, 2, 5]) {
      const text = queueHintText(n);
      expect(text).toContain('已排队');
      expect(text).toContain(String(n));
      expect(text).not.toContain('自动发送');
    }
  });

  it('no exported copy constant contains 「自动发送」', () => {
    const exportedStrings = Object.values(sendQueue).filter(
      (v): v is string => typeof v === 'string',
    );
    for (const s of exportedStrings) expect(s).not.toContain('自动发送');
    expect(sendQueueSrc).not.toContain('自动发送');
    expect(bar).not.toContain('自动发送');
  });

  it('InputBar renders the hint only when queuedCount > 0', () => {
    const row = bar.slice(bar.indexOf('className="busy-enter-hint"'));
    // The text node and the 取消排队 button are both gated on a real
    // queue; streaming alone renders an empty (but still reserved) row.
    expect(row).toContain('queuedCount > 0 && queueHintText(queuedCount)');
    expect(row).toContain('queuedCount > 0 && onCancelQueue');
    // The row keeps its live-region contract for the queued notice.
    expect(row).toContain('role="status"');
    expect(row).toContain('aria-live="polite"');
  });

  it('the pending AI bubble keeps the 「正在…」 progress label', () => {
    expect(generationProgressLabel(0, true)).toContain('正在');
    expect(generationProgressLabel(12, true)).toBe('已生成 12 字');
  });

  it('progress copy renders inside the assistant bubble, never under a user bubble', () => {
    const bubble = read('components/MessageBubble.tsx');
    const chatWindow = read('components/ChatWindow.tsx');
    // The label only exists for non-user streaming messages, and it is
    // rendered inside the bubble's generation-progress / streaming
    // indicator — the composer hint row never enters the message list.
    expect(bubble).toContain(
      'generationProgressLabel(message.content.length, !isUser && !!message.streaming)',
    );
    expect(bubble).toContain('className="generation-progress"');
    expect(bubble).toContain('showStreamingIndicator =\n    !isUser');
    expect(chatWindow).not.toContain('busy-enter-hint');
    expect(bubble).not.toContain('busy-enter-hint');
  });
});
