/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
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
 * P381 — at 1440×900 the first reply's DOM was
 * `.bubble-col.assistant > .tool-events[data-role="intent-chip"] >
 * .tool-badge.done`, so `.bubble-row.innerText` opened with 「排约会」「✓」
 * and the chip read as a reply header. The strip now leaves `.bubble-col`
 * entirely: a collapsed `<details class="tool-record">` on the row's own
 * first line labels the feedback channel (「已使用 N 个工具 · 完成」) and
 * keeps the badges one expand away, so badge text can never lead the
 * reply.
 *
 * The contract is exercised end-to-end — mount the app on the fake DOM,
 * send 「明天第一次约会安排在哪儿」, drive a plan_date tool round over the
 * controlled SSE stream, then assert the row's innerText and the chip's
 * ancestry at both acceptance viewports.
 */

const PROMPT = '明天第一次约会安排在哪儿';
const REPLY =
  '第一次约会选交通都方便、能自然聊天的地方：商圈的咖啡座或展览旁的小店都合适。';
const CHIP_LINE =
  /^\s*(排约会|接话术|改资料|看匹配|关系建议|我们合不合适)\s*\n?\s*✓/;

describe('P381 · intent chips sit outside .bubble-col in a collapsed record', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let root: Root;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const assistantRow = () => {
    const all = qsa('.bubble-row.assistant');
    return all[all.length - 1] as FakeElement | undefined;
  };

  beforeAll(async () => {
    dom = installFakeDom();
    streams = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url =
        typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        const stream = new ControlledSseStream();
        streams.push(stream);
        return sseResponse(stream);
      }
      if (url === '/api/tools') return jsonResponse({ tools: [] });
      if (url === '/api/health') {
        return jsonResponse({
          status: 'ok',
          llmConfigured: true,
          llmModel: 'qwen3.8-flash',
        });
      }
      if (url.startsWith('/api/session/restore')) return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });

    // --- send 「明天第一次约会安排在哪儿」 through the real composer ----
    const ta = qs('textarea') as FakeElement;
    ta.value = PROMPT;
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

    // --- one plan_date tool round, then the reply -----------------------
    await act(async () => {
      streams[0].push(
        sse('tool_start', { name: 'plan_date' }),
        sse('tool_end', { name: 'plan_date', result: { venue: 'coffee' } }),
        sse('delta', { content: REPLY }),
        sse('message', { content: REPLY, role: 'assistant' }),
        sse('done', {
          sessionId: 's-p381-test',
          tool: 'plan_date',
          tokens: 120,
          latencyMs: 1200,
        }),
      );
      streams[0].close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** The acceptance contract, checked identically at both viewports. */
  const assertContract = (label: string) => {
    const row = assistantRow();
    expect(row, `${label}: assistant bubble-row`).toBeTruthy();

    // The reply rendered and badge text never leads the row's text.
    expect(row!.innerText).toContain(REPLY);
    expect(row!.innerText).not.toMatch(CHIP_LINE);
    // No .bubble-row at all may lead with a chip label + ✓.
    for (const r of qsa('.bubble-row') as FakeElement[]) {
      expect(r.innerText).not.toMatch(CHIP_LINE);
    }

    // The chip strip is outside .bubble-col or default-hidden — here both:
    // it lives in a <details> record that is closed by default.
    const chip = row!.querySelector('[data-role="intent-chip"]') as
      | FakeElement
      | null;
    expect(chip, `${label}: intent-chip strip`).toBeTruthy();
    const collapsedRecord = chip!.closest('details');
    const defaultHidden = !!collapsedRecord && !collapsedRecord.hasAttribute('open');
    expect(
      chip!.closest('.bubble-col') === null || defaultHidden,
      `${label}: chip must leave .bubble-col or render hidden by default`,
    ).toBe(true);
    expect(chip!.closest('.bubble-col')).toBeNull();
    expect(defaultHidden).toBe(true);

    // The record is the row's head meta line, ahead of .bubble-col.
    const record = row!.querySelector('.tool-record') as FakeElement;
    const col = row!.querySelector('.bubble-col') as FakeElement;
    expect(record.tagName).toBe('DETAILS');
    expect(row!.childNodes.indexOf(record)).toBeLessThan(
      row!.childNodes.indexOf(col),
    );
  };

  it('1440×900: badge text never leads the reply, chip outside .bubble-col', () => {
    (dom.window as Record<string, unknown>).innerWidth = 1440;
    (dom.window as Record<string, unknown>).innerHeight = 900;
    assertContract('1440×900');
  });

  it('390×844: the same contract holds on the phone viewport', () => {
    (dom.window as Record<string, unknown>).innerWidth = 390;
    (dom.window as Record<string, unknown>).innerHeight = 844;
    assertContract('390×844');
  });
});
