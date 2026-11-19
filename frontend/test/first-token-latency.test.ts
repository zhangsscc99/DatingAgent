/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * P356 — first-token latency regressed to 1.5–2.2 s while the pending
 * bubble offered no machine-readable typing state: a 4 s generation
 * window showed nothing but a button state change. The pending AI
 * bubble now carries a visible three-dot indicator exposed as a polite
 * live region labelled 正在输入, rendered synchronously on submit
 * (before fetch/await), and it unmounts the moment the first streamed
 * token lands in the bubble.
 *
 * Vitest runs in node with no DOM, so the app mounts against the fake
 * DOM (./helpers/fakeDom.ts) plus a controllable slow SSE fetch mock —
 * the first token is pushed 200 ms after submit, mirroring the mocked
 * upstream latency the acceptance requires. Note: the fake DOM's
 * querySelector only understands `[attr]`/`[attr="v"]`, so the
 * `[aria-label*="正在输入"]` contract is asserted by filtering
 * `[aria-label]` elements on the attribute value.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const PROMPT = '她今天回消息特别慢，我要不要追问？';
const FIRST_TOKEN = '先别急着追问，';
const FULL_REPLY = '先别急着追问，给她一点空间。';

describe('P356 · typing indicator covers the pre-first-token window', () => {
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

  /** Elements whose aria-label contains 正在输入 — the fake DOM has no *= selector. */
  const typingIndicators = () =>
    qsa('[aria-label]').filter((el) =>
      (el.getAttribute('aria-label') ?? '').includes('正在输入'),
    );
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
    // Skip the onboarding modal: the composer must be the first surface.
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

  it('a labelled polite typing indicator mounts within 300 ms of submit and clears on the first token', async () => {
    // --- submit --------------------------------------------------------
    const ta = qs('textarea') as FakeElement;
    ta.value = PROMPT;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement;

    const submittedAt = Date.now();
    await act(async () => {
      send.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();

    // The mocked upstream holds the first token for 200 ms — the indicator
    // must already be on screen (rendered synchronously at submit, well
    // inside the 300 ms budget) while the stream is still silent.
    const submitToIndicatorMs = Date.now() - submittedAt;
    expect(submitToIndicatorMs).toBeLessThan(300);

    const indicators = typingIndicators();
    expect(indicators.length, 'typing indicator aria-labelled 正在输入').toBeGreaterThan(0);
    const indicator = indicators[0] as FakeElement;
    expect(indicator.getAttribute('aria-live')).toBe('polite');

    // It is the pending AI bubble's three-dot typing state, not a banner.
    const pendingBubble = lastAssistantBubble();
    expect(pendingBubble).toBeTruthy();
    expect(pendingBubble!.contains(indicator)).toBe(true);
    expect(indicator.querySelector('.streaming-dots')).toBeTruthy();
    expect(pendingBubble!.querySelector('.streaming-indicator')).toBeTruthy();

    // --- first token lands 200 ms after submit ------------------------
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      streams[0].push(sse('delta', { content: FIRST_TOKEN }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    // (b) the indicator is gone and the real body text renders instead.
    expect(typingIndicators()).toHaveLength(0);
    expect(pendingBubble!.querySelector('.streaming-indicator')).toBeNull();
    expect(lastAssistantBubble()!.textContent).toContain(FIRST_TOKEN);

    // --- stream settles: still no resurrected indicator ---------------
    await act(async () => {
      streams[0].push(
        sse('message', { content: FULL_REPLY, role: 'assistant' }),
        sse('done', { sessionId: 's-p356-test', tokens: 24, latencyMs: 900 }),
      );
      streams[0].close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(typingIndicators()).toHaveLength(0);
    expect(lastAssistantBubble()!.textContent).toContain(FULL_REPLY);
  });

  it('every placeholder-creating path marks the bubble streaming+thinking synchronously', () => {
    // runSend, retry, regen and 生成回复 all append the pending bubble in a
    // synchronous setMessages before fetch is awaited — the indicator can
    // never wait on the network. Guard the contract at the source level.
    const app = read('App.tsx');
    const creates = app.match(/streamPhase:\s*'thinking'/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(3);
    expect(app).toContain('setMessages((prev) => [');
  });

  it('the indicator keeps the visible ticker decorative so the live region stays quiet', () => {
    const indicator = read('components/StreamingIndicator.tsx');
    expect(indicator).toContain('aria-live="polite"');
    expect(indicator).toContain('aria-label="正在输入"');
    expect(indicator).toContain('className="streaming-dots"');
    // The per-second waiting label must not become live-region chatter.
    expect(indicator).toContain('className="streaming-label" aria-hidden="true"');
  });
});
