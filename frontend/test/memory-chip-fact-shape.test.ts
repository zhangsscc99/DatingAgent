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
 * P366 — the Round-97 walkthrough (1795072237, 390×844) showed the capsule
 * and sidebar listing 「记得 2 件事：她三天没回我消息了；她先不回我的」:
 * the second entry was a half-clause a reader cannot parse, and the first
 * was identical to the session title — two slots, one readable fact.
 *
 * The capsule contract pinned here: every pill is a standalone fact
 * (≥6 chars), a fact identical to the session title is filtered out of
 * the pill rows and the 记得 N 件事 lead (the title already says it) but
 * stays listed in the 管理记忆 panel, and each fact renders on its own
 * line — at most 3 fact lines plus one 「+N」 chip.
 *
 * Layout-honesty note (same as memory-chip-wrap.test.ts): the fake DOM
 * computes no layout, so "each fact on its own line" is pinned on the
 * parsed CSS (flex-basis 100% per pill) plus the live smoke, not on
 * fabricated geometry.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);

const noop = () => {};

const TITLE = '她三天没回我消息了';

const turns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: TITLE },
  { id: 'a1', role: 'assistant', content: '先别连发，给她一点空间。' },
];

/** Five stored facts — the first is identical to the session title. */
const FACT_LABELS = [
  TITLE,
  '我明天第一次约会',
  '她周末答应和我去看展了',
  '我有点怕自己把气氛搞砸',
  '我昨晚没睡好',
];

const DISPLAYED_LABELS = FACT_LABELS.slice(1);

function cssRule(selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...chatWindowCss.matchAll(re)].map((m) => m[1]).join('\n');
}

describe('P366 · capsule facts are standalone lines, deduped against the title', () => {
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
    const memory: ConversationMemory = {
      count: FACT_LABELS.length,
      items: FACT_LABELS.map((label, i) => ({
        key: label,
        text: label,
        ts: i + 1,
      })) as MemoryFact[],
    };
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
          sessionId: 's-p366',
          memory,
          onForgetMemory: noop,
          sessionTitle: TITLE,
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

  it('every pill is a standalone fact: ≥6 chars and never the session title', () => {
    const facts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(facts).toEqual(DISPLAYED_LABELS.slice(0, 3));
    for (const text of facts) {
      expect(text.length, `fact ${text}`).toBeGreaterThanOrEqual(6);
      expect(text).not.toBe(TITLE);
    }
  });

  it('the lead count excludes the title duplicate and the overflow is one 「+N」 chip', () => {
    expect(qs('.memory-capsule-lead')!.textContent).toBe('记得 4 件事');
    // At most 3 fact pills plus a single 「+N」 for the rest.
    expect(qsa('span[data-fact]')).toHaveLength(3);
    const more = qsa('.memory-capsule-more');
    expect(more).toHaveLength(1);
    expect(more[0].textContent).toBe('+1');
    // The capsule never repeats the session title.
    expect(qs('.memory-capsule-text')!.textContent).not.toContain(TITLE);
  });

  it('each fact renders on its own line — pills claim a full row in the stylesheet', () => {
    const factRule = cssRule('.memory-capsule-fact');
    expect(factRule).toContain('flex: 0 0 100%');
    // The row budget: lead + 3 fact lines + one 「+N」 line, 18px rows
    // with the declared gap — clipped at a row boundary, never ellipsised.
    const textRule = cssRule('.memory-capsule-text');
    const maxHeight = Number(/max-height\s*:\s*([0-9.]+)px/.exec(textRule)?.[1]);
    const rowGap = Number(/row-gap\s*:\s*([0-9.]+)px/.exec(textRule)?.[1] ?? 0);
    expect(maxHeight).toBeGreaterThanOrEqual(18 * 4);
    expect(maxHeight).toBeLessThanOrEqual(18 * 5 + rowGap * 4);
    expect(textRule).not.toContain('text-overflow');
  });

  it('the 管理记忆 panel still lists the title-identical fact for management', async () => {
    await click(qs('.memory-capsule'));
    const labels = qsa('.memory-panel-text').map((el) => el.textContent);
    expect(labels).toEqual(FACT_LABELS);
    await click(qs('.memory-capsule'));
    expect(qs('.memory-panel')).toBeNull();
  });
});
