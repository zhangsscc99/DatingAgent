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
import type { ChatMessage, ConversationMemory, MemoryFact } from '../src/types';

/**
 * P351 — the memory capsule joined every fact with ； on a single nowrap
 * line: at 390×844 the tail (「共 N 条」 included) was eaten by
 * text-overflow: ellipsis, so「我记得什么」 was only ever true for the
 * first fact. The capsule now leads with an always-visible 记得 N 件事
 * count and renders each fact as its own pill (`span[data-fact]`) — one
 * fact per line (P366), at most three fact lines plus a 「+N」 chip with
 * no ellipsis — and the existing 管理记忆 panel still lists every fact.
 *
 * Layout-honesty note (same as memory-chip-overlap.test.ts): this fake
 * DOM computes no layout — scrollWidth/clientWidth and the rects are all
 * 0, so the geometry assertions hold trivially here and the real
 * guarantees are pinned on the parsed CSS (wrap + max-height, no
 * text-overflow) plus the live smoke at 390×844.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);

const noop = () => {};

const turns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '她周末答应和我去看展' },
  { id: 'a1', role: 'assistant', content: '很轻的安排，适合开口。' },
];

function seedFacts(n: number): MemoryFact[] {
  const labels = [
    '她周末答应和我去看展',
    '她昨天一整天没回我消息',
    '我昨晚没睡好',
    '带闺蜜',
    '三个小时没回',
  ];
  return labels
    .slice(0, n)
    .map((label, i) => ({ key: label, text: label, ts: i + 1 }));
}

function cssRule(selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...chatWindowCss.matchAll(re)].map((m) => m[1]).join('\n');
}

describe('P351 · capsule wraps facts as pills, count always visible', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const click = async (el: FakeElement | null) => {
    expect(el, 'click target').toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  async function mountWithFacts(count: number) {
    const memory: ConversationMemory = {
      count,
      items: seedFacts(count),
    };
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const nextRoot = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      nextRoot.render(
        createElement(ChatWindow, {
          messages: turns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-p351',
          memory,
          onForgetMemory: noop,
        }),
      );
    });
    await flush();
    return nextRoot;
  }

  beforeAll(async () => {
    dom = installFakeDom();
    root = await mountWithFacts(3);
  });

  afterAll(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    vi.unstubAllGlobals();
  });

  it('3 injected facts render 3 pills and a 记得 3 件事 lead', () => {
    const capsule = qs('.memory-capsule');
    expect(capsule).toBeTruthy();
    expect(capsule!.querySelectorAll('span[data-fact]')).toHaveLength(3);
    const lead = qs('.memory-capsule-lead');
    expect(lead).toBeTruthy();
    const m = /记得\s*(\d+)\s*件事/.exec(lead!.textContent);
    expect(m, 'lead names the fact count').toBeTruthy();
    expect(Number(m![1])).toBe(3);
    // No 「+N」 chip when nothing is hidden behind the panel.
    expect(qs('.memory-capsule-more')).toBeNull();
  });

  it('the capsule never ellipsises: no overflow in the DOM, no ellipsis in the CSS', () => {
    const capsule = qs('.memory-capsule')!;
    const text = qs('.memory-capsule-text')!;
    // No truncation is in effect: the content fits inside the container.
    expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
    expect(capsule.scrollWidth).toBeLessThanOrEqual(capsule.clientWidth);
    // The count lead sits inside the capsule's right edge — never clipped.
    const lead = qs('.memory-capsule-lead')!;
    expect(lead.getBoundingClientRect().right).toBeLessThanOrEqual(
      capsule.getBoundingClientRect().right,
    );
    // …and the stylesheet can no longer truncate: the text wraps and the
    // container clips at a row boundary instead of ellipsising.
    const textRule = cssRule('.memory-capsule-text');
    expect(textRule).toContain('flex-wrap: wrap');
    expect(textRule).toContain('overflow: hidden');
    expect(textRule).not.toContain('text-overflow: ellipsis');
    expect(textRule).not.toContain('white-space: nowrap');
    expect(cssRule('.memory-capsule')).not.toContain('text-overflow');
  });

  it('the capsule content is capped at a row boundary', () => {
    const text = qs('.memory-capsule-text')!;
    // DOM check (0 in fake DOM) + CSS check: max-height <= lead + three
    // 18px fact lines + one 「+N」 line, plus the declared row gaps (P366:
    // one fact per line).
    const lineHeight = 18;
    expect(text.getBoundingClientRect().height).toBeLessThanOrEqual(
      lineHeight * 5,
    );
    const textRule = cssRule('.memory-capsule-text');
    const maxHeight = Number(
      /max-height\s*:\s*([0-9.]+)px/.exec(textRule)?.[1],
    );
    const rowGap = Number(/row-gap\s*:\s*([0-9.]+)px/.exec(textRule)?.[1] ?? 0);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(lineHeight * 5 + rowGap * 4);
  });

  it('clicking the capsule lists every fact in the 管理记忆 panel', async () => {
    expect(qs('.memory-panel')).toBeNull();
    await click(qs('.memory-capsule'));
    const rows = qsa('.memory-panel-row');
    expect(rows).toHaveLength(3);
    const labels = qsa('.memory-panel-text').map((el) => el.textContent);
    expect(labels).toEqual([
      '她周末答应和我去看展',
      '她昨天一整天没回我消息',
      '我昨晚没睡好',
    ]);
    await click(qs('.memory-capsule'));
    expect(qs('.memory-panel')).toBeNull();
  });

  it('5 facts: lead still counts all, pills cap at 3 with a +2 chip', async () => {
    await act(async () => {
      root!.unmount();
    });
    root = await mountWithFacts(5);
    try {
      expect(qs('.memory-capsule-lead')!.textContent).toContain('记得 5 件事');
      expect(qsa('span[data-fact]')).toHaveLength(3);
      const more = qs('.memory-capsule-more');
      expect(more).toBeTruthy();
      expect(more!.textContent).toBe('+2');
      await click(qs('.memory-capsule'));
      expect(qsa('.memory-panel-row')).toHaveLength(5);
      await click(qs('.memory-capsule'));
    } finally {
      await act(async () => {
        root!.unmount();
      });
      root = await mountWithFacts(3);
    }
  });
});
