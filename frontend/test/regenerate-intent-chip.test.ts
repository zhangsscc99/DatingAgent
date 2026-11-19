/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
  type FakeNode,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P370 — Round 98, third 「换一个」 click: the bubble's innerText began with
 * `排约会\n✓\n\n再换一个角度：…` — the sidebar quick-entry label rendered
 * inside the bubble as if it were the reply's first line (the tool badge
 * used to be a child of `.bubble`, ahead of `.bubble-content`).
 *
 * The chip strip now lives outside `.bubble` in a `.bubble-col` wrapper and
 * carries `data-role="intent-chip"`: still visible as action feedback, but
 * the bubble's first non-empty line is always reply text. Same fake-DOM
 * mount as bubble-tool-meta-label.test.ts.
 */

const CHIP_LINE = /(排约会|接话术|改资料|看匹配|关系建议|我们合不合适)\s*\n?\s*✓/;
const CHIP_LABELS = ['排约会', '接话术', '改资料', '看匹配', '关系建议', '我们合不合适'];

const NOW = Date.now();

/** A reply after the third 「换一个」: parked version, bumped index, a plan_date badge. */
const REGENNED: ChatMessage = {
  id: 'a-regen',
  role: 'assistant',
  content: '再换一个角度：第一次约会别排太满，选交通都方便的安静小店，聊得好再顺延。',
  createdAt: NOW,
  toolEvents: [{ name: 'plan_date', label: '排约会', status: 'done' }],
  meta: { tool: 'plan_date', tokens: 210, latencyMs: 6400 },
  versionIndex: 3,
  previousVersion: {
    content: '换个思路：约一杯咖啡的时长，聊不动也好收场。',
    toolEvents: [{ name: 'plan_date', label: '排约会', status: 'done' }],
  },
};

/** A first-turn reply that used two tools. */
const TWO_TOOLS: ChatMessage = {
  id: 'a-two',
  role: 'assistant',
  content: '先接住她这句话的情绪，再给一句可以直接发的回复。',
  createdAt: NOW,
  toolEvents: [
    { name: 'coach_conversation', label: '接话术', status: 'done' },
    { name: 'get_relationship_advice', label: '关系建议', status: 'done' },
  ],
};

function firstNonEmptyLine(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
}

describe('P370 · intent chips live outside the reply bubble', () => {
  let dom: FakeDom;
  const rows = () =>
    Array.from(dom.document.querySelectorAll('.bubble-row')) as FakeElement[];

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: MessageBubble } = await import('../src/components/MessageBubble');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(MessageBubble, { message: REGENNED }),
          createElement(MessageBubble, { message: TWO_TOOLS }),
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(() => {
    // fake DOM is process-global; nothing persistent to tear down
  });

  it('the chip strip renders above the bubble, marked data-role="intent-chip"', () => {
    for (const row of rows()) {
      const chip = row.querySelector('[data-role="intent-chip"]');
      const bubble = row.querySelector('.bubble');
      const col = row.querySelector('.bubble-col');
      expect(chip, 'intent-chip strip').toBeTruthy();
      expect(bubble, 'bubble').toBeTruthy();
      expect(col, 'bubble-col wrapper').toBeTruthy();

      // Outside the bubble, but stacked directly above it in the same column.
      expect(bubble!.contains(chip as unknown as FakeNode)).toBe(false);
      expect(chip!.parentElement).toBe(col);
      expect(bubble!.parentElement).toBe(col);
      expect(col!.childNodes.indexOf(chip!)).toBeLessThan(col!.childNodes.indexOf(bubble!));
      expect(bubble!.querySelector('.tool-badge')).toBeNull();
      expect(bubble!.querySelector('[data-role="intent-chip"]')).toBeNull();
    }
  });

  it('the regenerated bubble’s first non-empty innerText line is reply text, not a label', () => {
    const bubble = rows()[0].querySelector('.bubble')!;
    const head = firstNonEmptyLine(bubble.innerText);
    expect(head).not.toContain('✓');
    for (const label of CHIP_LABELS) expect(head).not.toContain(label);
    expect(bubble.innerText).not.toMatch(CHIP_LINE);
    expect(head.startsWith('再换一个角度')).toBe(true);
  });

  it('a two-tool bubble keeps the same contract', () => {
    const bubble = rows()[1].querySelector('.bubble')!;
    const head = firstNonEmptyLine(bubble.innerText);
    expect(bubble.innerText).not.toMatch(CHIP_LINE);
    expect(bubble.innerText).not.toContain('✓');
    expect(head.startsWith('先接住')).toBe(true);
  });

  it('the labels stay visible once each — as chips, not bubble text', () => {
    const row = rows()[0];
    expect((row.innerText.match(/排约会/g) ?? []).length).toBe(1);
    const row2 = rows()[1];
    expect((row2.innerText.match(/接话术/g) ?? []).length).toBe(1);
    expect((row2.innerText.match(/关系建议/g) ?? []).length).toBe(1);
    expect(row2.querySelectorAll('.tool-badge')).toHaveLength(2);
  });
});
