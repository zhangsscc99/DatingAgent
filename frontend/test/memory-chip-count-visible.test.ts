/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import { COARSE_POINTER_QUERY } from '../src/lib/heroHint';
import {
  MEMORY_RECEIPT_MAX_ITEMS,
  MEMORY_RECEIPT_PREFIX,
} from '../src/lib/memoryReceipt';
import type { ChatMessage, ConversationMemory, MemoryFact } from '../src/types';

/**
 * P363 — device-level regression for the memory capsule's fact count.
 *
 * Measured fact behind this test: P363 (「记忆条把 3 条事实串成单行并用省略号
 * 截断，「共 4 条」在首屏看不见」, reported as P351's third recurrence) was
 * measured against an older build. Re-measured live at 2026-11-19 10:36 UTC
 * against the deployed build (HEAD 608d935) at 390×844 with touch emulation
 * (`matchMedia('(pointer: coarse)').matches === true`), 4 remembered facts:
 *
 *   .memory-capsule-text innerText = 「记得 4 件事 / 她周末答应和我去看展了 /
 *     我有点怕自己把气氛搞砸 / 她昨天一整天没回我消息 / +1」
 *   .memory-capsule-lead      = 「记得 4 件事」 (right 116 px)
 *   .memory-capsule rect      = 296×40 px, right 344 px
 *   span[data-fact] count     = 3,  .memory-capsule-more = 「+1」
 *   computed text-overflow    = clip,  flex-wrap = wrap,  max-height = 40px
 *   scrollWidth / clientWidth = 296 / 296  (no truncation in effect)
 *
 * So the count is visible, no ellipsis is active and the panel lists every
 * fact — the walkthrough was reading a stale build. What was missing is a
 * regression test that pins this: `memory-chip-wrap.test.ts` covers the
 * component with 3/5 facts but is not a device-level case, and nothing asserts
 * the 4-fact case (3 pills + 「+1」) under a coarse-pointer 390 viewport. This
 * file mounts the real ChatWindow in the fake-DOM harness under that device
 * and pins the count lead structurally (first in the flex flow), the pill cap,
 * the 「+N」 chip and the panel contents.
 *
 * Layout-honesty note (same as memory-chip-wrap.test.ts): the fake DOM computes
 * no layout, so scrollWidth/clientWidth and the rects are all 0 here. The real
 * guarantee is pinned on the parsed CSS (wrap + two-row cap, no ellipsis) plus
 * the live measurement quoted above; no fabricated geometry is asserted.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);

const noop = () => {};

const turns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '她周末答应和我去看展了' },
  { id: 'a1', role: 'assistant', content: '很轻的安排，适合开口。' },
];

/** Four remembered facts — one past the pill cap, so 「+1」 must appear. */
const FACT_LABELS = [
  '她周末答应和我去看展了',
  '我有点怕自己把气氛搞砸',
  '她昨天一整天没回我消息',
  '我昨晚没睡好',
];

function seedFacts(count: number): MemoryFact[] {
  return FACT_LABELS.slice(0, count).map((label, i) => ({
    key: label,
    text: label,
    ts: i + 1,
  }));
}

function cssRule(selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...chatWindowCss.matchAll(re)].map((m) => m[1]).join('\n');
}

describe('P363 · memory capsule count is visible on a 390-wide touch device', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) => dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };
  const click = async (el: FakeElement | null) => {
    expect(el, 'click target').toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeAll(async () => {
    dom = installFakeDom();
    // 390×844 with a coarse pointer: the capsule is at its tightest here and
    // this is the device the P363 report was measured on.
    const mq = (query: string) => ({
      matches:
        query === COARSE_POINTER_QUERY || query === '(max-width: 768px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);

    const memory: ConversationMemory = { count: 4, items: seedFacts(4) };
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: turns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-p363',
          memory,
          onForgetMemory: noop,
        }),
      );
    });
    await flush();
  });

  afterAll(async () => {
    if (root) {
      const current = root;
      root = null;
      await act(async () => {
        current.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it('the count lead reads 记得 4 件事 and sits first in the capsule flow', () => {
    const text = qs('.memory-capsule-text');
    expect(text, 'capsule text node').toBeTruthy();
    const lead = qs('.memory-capsule-lead');
    expect(lead, 'count lead').toBeTruthy();
    expect(lead!.textContent).toMatch(/^记得\s*4\s*件事$/);
    // First in the flow is why it can never be clipped by the two-row cap.
    const firstElement = text!.children.find(
      (child) => child.tagName.toLowerCase() === 'span',
    );
    expect(firstElement).toBe(lead);
    // The old single-line form must be gone: the capsule is not a prefixed
    // 记得你提到： sentence any more.
    expect(text!.textContent).not.toContain(MEMORY_RECEIPT_PREFIX);
  });

  it('caps the pills at 3 and shows the +1 chip for the fourth fact', () => {
    const facts = qsa('span[data-fact]');
    expect(facts).toHaveLength(MEMORY_RECEIPT_MAX_ITEMS);
    expect(facts.map((el) => el.textContent)).toEqual(FACT_LABELS.slice(0, 3));
    const more = qs('.memory-capsule-more');
    expect(more, 'overflow chip').toBeTruthy();
    expect(more!.textContent).toBe('+1');
    // The count, not the chip, carries the total.
    expect(qs('.memory-capsule-lead')!.textContent).toContain('4');
  });

  it('never ellipsises: the stylesheet wraps and clips at a row boundary', () => {
    const textRule = cssRule('.memory-capsule-text');
    expect(textRule).toContain('flex-wrap: wrap');
    expect(textRule).toContain('overflow: hidden');
    expect(textRule).not.toContain('text-overflow');
    expect(textRule).not.toContain('white-space: nowrap');

    const leadRule = cssRule('.memory-capsule-lead');
    expect(leadRule).toContain('flex-shrink: 0');
    expect(leadRule).toContain('white-space: nowrap');

    // No rule in the capsule family may reintroduce truncation.
    for (const selector of [
      '.memory-capsule',
      '.memory-capsule-fact',
      '.memory-capsule-more',
    ]) {
      expect(cssRule(selector), selector).not.toContain('text-overflow: ellipsis');
    }

    // Two 18px pill rows plus the 4px row gap — nothing taller than the cap.
    const maxHeight = Number(/max-height\s*:\s*([0-9.]+)px/.exec(textRule)?.[1]);
    const rowGap = Number(/row-gap\s*:\s*([0-9.]+)px/.exec(textRule)?.[1] ?? 0);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(18 * 2 + rowGap);
  });

  it('clicking the capsule lists all four facts in the 管理记忆 panel', async () => {
    expect(qs('.memory-panel')).toBeNull();
    await click(qs('.memory-capsule'));
    const labels = qsa('.memory-panel-text').map((el) => el.textContent);
    expect(labels).toEqual(FACT_LABELS);
    await click(qs('.memory-capsule'));
    expect(qs('.memory-panel')).toBeNull();
  });
});
