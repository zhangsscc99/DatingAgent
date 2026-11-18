/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  GENERATION_PROGRESS_ORGANIZING,
  GENERATION_PROGRESS_WRITING,
  generationProgressLabel,
} from '../src/lib/generationProgress';
import * as sendQueue from '../src/lib/sendQueue';
import { queueHintText } from '../src/lib/sendQueue';
import {
  installFakeDom,
  ControlledSseStream,
  sseResponse,
  jsonResponse,
  sse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';

/**
 * P272 — during a long reply the bubble offered only 「停止生成」 and no
 * quantitative signal that text was arriving. The pending bubble now shows
 * 「正在组织答案」 before the first token and a quiet progress line while
 * content streams; the line disappears the moment the turn settles.
 *
 * P318 — that line used to paint the raw 「已生成 N 字」 count at the
 * bubble's foot, which read like debug output. The in-stream line now
 * carries quiet human copy (「正在写…」 plus the dot pulse) and stays
 * aria-hidden; the App-level aria-live region still announces the phase
 * with human copy, never a number. The last block mounts the real app on
 * the fake DOM and drives a controlled SSE stream to prove it.
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
    expect(bubble).toContain('generationProgressLabel(bodyText.length');
    expect(bubble).toContain('!!message.streaming');
  });

  it('the counter line only exists while streaming with content', () => {
    expect(bubble).toContain('className="generation-progress"');
    expect(bubble).toContain('progressLabel && bodyText.length > 0');
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
      'generationProgressLabel(bodyText.length, !isUser && !!message.streaming)',
    );
    expect(bubble).toContain('className="generation-progress"');
    expect(bubble).toContain('showStreamingIndicator =\n    !isUser');
    expect(chatWindow).not.toContain('busy-enter-hint');
    expect(bubble).not.toContain('busy-enter-hint');
  });
});

describe('P318 · the pending bubble never paints the char count', () => {
  const COUNTER = /已生成|生成中.*字|[0-9]+\s*字/;

  it('the in-stream line is quiet human copy with no digits', () => {
    expect(GENERATION_PROGRESS_WRITING).toContain('正在');
    expect(GENERATION_PROGRESS_WRITING).not.toMatch(COUNTER);
  });

  it('the bubble paints GENERATION_PROGRESS_WRITING inside the line, never the raw label', () => {
    const bubble = read('components/MessageBubble.tsx');
    const div = bubble.slice(bubble.indexOf('className="generation-progress"'));
    expect(div).toContain('GENERATION_PROGRESS_WRITING');
    // The raw count still gates the line (progressLabel && length > 0) but
    // no {progressLabel} text node survives inside it.
    expect(div).not.toContain('{progressLabel}');
    // The pulse is the same dot animation the thinking indicator uses.
    expect(div).toContain('streaming-dots');
  });
});

describe('P318 · mounted — streaming bubble shows human copy only', () => {
  const COUNTER = /已生成|生成中.*字|[0-9]+\s*字/;
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let root: Root;

  const flush = async () => {
    // Let the fetch/read-loop promise chain settle, then let React commit.
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const lastAssistantBubble = () => {
    const all = qsa('.bubble.assistant');
    return all[all.length - 1] as FakeElement | undefined;
  };

  beforeAll(async () => {
    dom = installFakeDom();
    streams = [];
    fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        const stream = new ControlledSseStream();
        streams.push(stream);
        return sseResponse(stream);
      }
      if (url === '/api/tools') return jsonResponse({ tools: [] });
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', llmConfigured: true, llmModel: 'qwen3.8-flash' });
      }
      if (url.startsWith('/api/session/restore')) return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

    // react-dom must evaluate AFTER the fake DOM exists (canUseDOM).
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('pending + streaming phases carry no counter; aria-live keeps human copy; the line unmounts on done', async () => {
    const ta = qs('textarea') as FakeElement;
    ta.value = '她在加班，我该怎么回？';
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement;
    await act(async () => {
      send.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(streams).toHaveLength(1);

    // Pre-token pending placeholder — already no counter vocabulary.
    let bubble = lastAssistantBubble();
    expect(bubble).toBeTruthy();
    expect(bubble!.textContent).not.toMatch(COUNTER);

    // Partial content streaming in.
    await act(async () => {
      streams[0].push(sse('delta', { content: '先接住她的辛苦，' }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    bubble = lastAssistantBubble();
    expect(bubble!.textContent).toContain('先接住她的辛苦');
    const line = bubble!.querySelector('.generation-progress');
    expect(line, 'progress line while streaming').toBeTruthy();
    expect(line!.textContent).toContain('正在写');
    expect(line!.textContent).not.toMatch(COUNTER);
    expect(bubble!.textContent).not.toMatch(COUNTER);

    // An aria-live element still exists and carries human-moving copy —
    // a phase label, never a raw number.
    const live = qsa('[aria-live]').filter(
      (el) => el.textContent.trim().length > 0,
    ) as FakeElement[];
    expect(live.length).toBeGreaterThan(0);
    const liveText = live.map((el) => el.textContent).join('\n');
    expect(liveText).toMatch(/正在/);
    expect(liveText).not.toMatch(COUNTER);

    // The turn settles — the progress line unmounts entirely.
    await act(async () => {
      streams[0].push(
        sse('message', { content: '先接住她的辛苦，再轻轻带开话题。', role: 'assistant' }),
        sse('done', { sessionId: 's-p318-test', tokens: 30, latencyMs: 900 }),
      );
      streams[0].close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    bubble = lastAssistantBubble();
    expect(bubble!.textContent).toContain('再轻轻带开话题');
    expect(bubble!.querySelector('.generation-progress')).toBeNull();
    expect(bubble!.textContent).not.toMatch(COUNTER);
    expect(dom.document.body.textContent).not.toMatch(/已生成\s*\d+\s*字/);
  });
});
