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
 * P326 — while a reply streams, the composer's bottom-right used to show
 * TWO equal-weight primaries: the solid paper-plane send key and a solid
 * high-saturation --danger stop block — the page's only saturated red —
 * with nothing telling the user whether pressing send queued the draft or
 * interrupted the stream.
 *
 * Contract asserted here (mounted pending state + CSS source guards):
 *  1. Exactly ONE primary action renders at the bottom-right while
 *     streaming — the control carrying [data-primary-cta] — and its
 *     aria-label is 「停止生成」. The still-mounted send key drops the
 *     marker.
 *  2. The send key stays in the DOM (P224) and keeps its P244 queueing
 *     behaviour, but renders in the secondary register
 *     (data-variant="secondary", no accent fill) and names the queue
 *     semantics — 「排队」 — in its accessible name.
 *  3. The stop control is an accent OUTLINE in the same 44 px .input-send
 *     box — no solid var(--danger) anywhere in its rules.
 *  4. The idle send key is untouched: marker present, 发送消息 label,
 *     brand solid fill.
 *
 * Same fake-DOM + controllable-SSE harness as send-while-streaming.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const inputBarCss = read('components/InputBar.css');
const inputBarTsx = read('components/InputBar.tsx');

/** Declaration bodies of every `selector { … }` — exact selector match. */
function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1],
  );
}

/** All top-level (non-@media) bodies for a selector — a pending-state rule
 *  may also live inside the ≤768 px block, so callers pick explicitly. */
function topLevel(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    const openBrace = css.indexOf('{', at);
    let depth = 0;
    let j = openBrace;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

const TOP_CSS = topLevel(inputBarCss);

describe('P326 · pending composer keeps a single primary action', () => {
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
  const sendKey = () =>
    qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement | undefined;
  const stopKey = () => qs('.input-stop') as FakeElement | null;
  const hint = () => qs('.busy-enter-hint')?.textContent ?? '';

  const type = async (text: string) => {
    const ta = qs('textarea') as FakeElement;
    ta.value = text;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
  };

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  beforeAll(async () => {
    dom = installFakeDom();
    streams = [];
    const fetchMock = vi.fn(async (input: unknown) => {
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

  it('the pending bottom-right holds exactly ONE primary — aria-label 停止生成', async () => {
    // Idle baseline: send is the single primary with its normal name.
    const idleSend = sendKey();
    expect(idleSend).toBeTruthy();
    expect(idleSend!.getAttribute('data-primary-cta')).not.toBeNull();
    expect(idleSend!.hasAttribute('data-variant')).toBe(false);
    expect(idleSend!.getAttribute('aria-label')).toBe('发送消息');

    // Send a first message → the reply starts streaming (pending state).
    await type('她说明天要加班，我该说什么？');
    await click(sendKey());
    await flush();
    expect(streams).toHaveLength(1);
    await act(async () => {
      streams[0].push(
        sse('thinking', { message: '正在思考…' }),
        sse('delta', { content: '先接住她的辛苦，' }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // (a) exactly one primary marker in the whole pending UI, and it is
    //     the stop control — not the send key.
    const primaries = qsa('[data-primary-cta]');
    expect(primaries).toHaveLength(1);
    const primary = primaries[0];
    expect(primary.getAttribute('aria-label')).toBe('停止生成');
    expect(primary.classList.contains('input-stop')).toBe(true);
    expect(primary.closest('.input-bar')).not.toBeNull();
    // …and it is the bottom-right action: the last .input-send in the row.
    const sends = qsa('.input-send');
    expect(sends[sends.length - 1]).toBe(primary);

    // Exactly one non-secondary .input-send — the same single primary.
    const nonSecondary = qsa('.input-send').filter(
      (b) => (b as FakeElement).getAttribute('data-variant') !== 'secondary',
    );
    expect(nonSecondary).toHaveLength(1);
    expect(nonSecondary[0]).toBe(primary);
  });

  it('the send key stays mounted as a muted secondary that names its queue semantics', async () => {
    const send = sendKey();
    // P224: still in the DOM while streaming…
    expect(send).toBeTruthy();
    // …but demoted: secondary marker, no primary marker, no solid accent.
    expect(send!.getAttribute('data-variant')).toBe('secondary');
    expect(send!.hasAttribute('data-primary-cta')).toBe(false);
    // (b) the queue semantics live in the accessible name AND the title.
    expect(send!.getAttribute('aria-label')).toContain('排队');
    expect(send!.getAttribute('title')).toContain('排队');
    expect(send!.getAttribute('aria-label')).not.toBe('发送消息');
    // The stop key is the only one without the secondary marker.
    expect(stopKey()?.hasAttribute('data-variant')).toBe(false);

    // P244 intact: typing + pressing the secondary send still queues the
    // draft instead of interrupting the stream.
    await type('周末想约她看电影合适吗？');
    expect(send!.disabled).toBe(false);
    await click(send);
    await flush();
    expect((qs('textarea') as FakeElement).value).toBe('');
    expect(hint()).toContain('已排队 1 条');
    expect(streams).toHaveLength(1); // no second turn started

    // And the primary count still holds with a queue pending.
    expect(qsa('[data-primary-cta]')).toHaveLength(1);
  });

  it('the stop control is an accent outline in the same box — no solid --danger', () => {
    // (c) the pending-state CSS never paints a danger block again.
    const bodies = ruleBodies(inputBarCss, '.input-bar .input-stop');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain('--danger');
    }
    const stopTop = ruleBodies(TOP_CSS, '.input-bar .input-stop').join('\n');
    expect(stopTop).toContain('background: transparent');
    expect(stopTop).toContain('color: var(--accent)');
    expect(stopTop).toContain('border: 1px solid var(--accent)');

    // Same-size box as send — stop keeps the shared .input-send 44 px
    // shell in the markup, so nothing jumps when the pair renders.
    expect(inputBarTsx).toContain('className="input-send input-stop"');
    const sendRule = ruleBodies(TOP_CSS, '.input-bar .input-send').join('\n');
    expect(sendRule).toContain('width: 44px');
    expect(sendRule).toContain('height: 44px');
    // The ≤768 px block keeps stop beside send at the right edge (P309).
    expect(inputBarCss).toContain('.input-bar .input-send.input-stop');
    expect(inputBarCss).toContain('margin-left: 0');
  });

  it('the secondary send rule is muted — no accent fill — and idle rules are untouched', () => {
    const secondary = ruleBodies(
      TOP_CSS,
      ".input-bar .input-send[data-variant='secondary']",
    ).join('\n');
    expect(secondary).not.toBe('');
    expect(secondary).toContain('background: var(--surface-hover)');
    expect(secondary).not.toContain('background: var(--accent)');

    // Idle send keeps the brand solid; the base rule is unchanged.
    const base = ruleBodies(TOP_CSS, '.input-bar .input-send').join('\n');
    expect(base).toContain('background: var(--accent)');
    expect(base).toContain('color: var(--on-accent)');

    // The tsx still declares send first, stop second (P224 DOM order).
    const sendIdx = inputBarTsx.indexOf('className="input-send"');
    const stopIdx = inputBarTsx.indexOf('className="input-send input-stop"');
    expect(sendIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(sendIdx);
  });
});
