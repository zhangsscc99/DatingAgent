/// <reference types="node" />
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import InputBar from '../src/components/InputBar';
import MessageBubble from '../src/components/MessageBubble';
import { buildChatRequestBody } from '../src/lib/chatRequest';
import {
  CONSTRAINT_CHIPS,
  constraintHintText,
  constraintSummaryLine,
} from '../src/lib/constraintChips';
import { serializeMessages } from '../src/lib/chatStorage';
import {
  FakeEvent,
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P407 — 本轮约束 capsules on the composer. Three multi-select chips
 * (我不想主动 / 只能发短信 / 预算有限) splice a 「本轮约束：…」 hint into the
 * outgoing message through the existing chatRequest channel; the turn's
 * assistant bubble echoes 「已按约束：…」 from persisted metadata. With no
 * chip picked the serialized request body is byte-identical to today.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarCss = readFileSync(join(SRC, 'components', 'InputBar.css'), 'utf8');

const noop = () => {};

const renderBar = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(InputBar, {
      onSend: noop,
      replyLength: 'default' as const,
      onReplyLengthChange: noop,
      ...extra,
    }),
  );

describe('P407 · hint/summary helpers', () => {
  it('constraintHintText joins picked labels with 、 under the prefix', () => {
    expect(constraintHintText([])).toBe('');
    expect(constraintHintText(['我不想主动'])).toBe('本轮约束：我不想主动');
    expect(constraintHintText(['我不想主动', '只能发短信'])).toBe(
      '本轮约束：我不想主动、只能发短信',
    );
    expect(
      constraintHintText(['我不想主动', '只能发短信', '预算有限']),
    ).toBe('本轮约束：我不想主动、只能发短信、预算有限');
  });

  it('constraintSummaryLine renders the dim bubble header (summary forms)', () => {
    expect(constraintSummaryLine([])).toBe('');
    expect(constraintSummaryLine(['我不想主动'])).toBe('已按约束：不想主动');
    expect(constraintSummaryLine(['我不想主动', '预算有限'])).toBe(
      '已按约束：不想主动、预算有限',
    );
    expect(
      constraintSummaryLine(['我不想主动', '只能发短信', '预算有限']),
    ).toBe('已按约束：不想主动、只能发短信、预算有限');
  });
});

describe('P407 · request body stays byte-identical without picks', () => {
  const fields = {
    sessionId: 's-1',
    message: '她昨天没回我',
    language: 'auto' as const,
  };

  it('no constraints key → identical to the pre-P407 body', () => {
    const body = buildChatRequestBody(fields);
    expect(body).toBe(
      JSON.stringify({ sessionId: 's-1', message: '她昨天没回我', language: 'auto' }),
    );
  });

  it('empty constraints → identical to the no-chip baseline', () => {
    expect(buildChatRequestBody({ ...fields, constraints: [] })).toBe(
      buildChatRequestBody(fields),
    );
    expect(buildChatRequestBody({ ...fields, constraints: undefined })).toBe(
      buildChatRequestBody(fields),
    );
  });

  it('picked chips splice the 本轮约束 hint into message — no new field', () => {
    const body = buildChatRequestBody({
      ...fields,
      constraints: ['我不想主动', '只能发短信'],
    });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.message).toBe(
      '她昨天没回我\n\n本轮约束：我不想主动、只能发短信',
    );
    expect(String(parsed.message)).toContain('本轮约束：我不想主动、只能发短信');
    // No contract change: same top-level keys as the baseline body.
    expect(Object.keys(parsed)).toEqual(['sessionId', 'message', 'language']);
  });
});

describe('P407 · composer chips', () => {
  it('renders three capsules as a group above the tool row', () => {
    const html = renderBar();
    expect(html).toContain('constraint-chips');
    expect(html).toContain('aria-label="本轮约束"');
    for (const chip of CONSTRAINT_CHIPS) {
      expect(html).toContain(chip.label);
    }
    expect(html.match(/class="constraint-chip"/g)?.length).toBe(3);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(3);
    // The chips own their own row — above .input-tools so 回答适中/发送
    // never share the line.
    expect(html.indexOf('constraint-chips')).toBeLessThan(
      html.indexOf('input-tools'),
    );
  });

  it('picked state uses secondary/surface tokens, never the brand fill', () => {
    const block = inputBarCss.slice(
      inputBarCss.indexOf(".constraint-chip[aria-pressed='true']"),
    );
    const rule = block.slice(0, block.indexOf('}'));
    expect(rule).toContain('var(--surface-hover)');
    expect(rule).toContain('var(--text-secondary)');
    expect(rule).not.toContain('var(--accent)');
  });

  it('the chips row cannot overflow or wrap (390×844 / 1440×900)', () => {
    const rowBlock = inputBarCss.slice(inputBarCss.indexOf('.constraint-chips'));
    const rowRule = rowBlock.slice(0, rowBlock.indexOf('}'));
    expect(rowRule).toContain('flex-basis: 100%');
    expect(rowRule).toContain('flex-wrap: nowrap');
    const chipBlock = inputBarCss.slice(inputBarCss.indexOf('.constraint-chip {'));
    const chipRule = chipBlock.slice(0, chipBlock.indexOf('}'));
    expect(chipRule).toContain('white-space: nowrap');
  });
});

describe('P407 · mounted chips toggle aria-pressed and ride the send', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  const onSend = vi.fn();

  const qsa = (sel: string) =>
    dom.document.querySelectorAll(sel) as FakeElement[];
  const chips = () => qsa('.constraint-chip');
  const pressed = () =>
    chips().map((c) => c.getAttribute('aria-pressed'));

  const click = async (el: FakeElement) => {
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: InputBar } = await import('../src/components/InputBar');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(InputBar, {
          onSend,
          replyLength: 'default',
          onReplyLengthChange: noop,
        }),
      );
      await Promise.resolve();
    });
  });

  afterAll(async () => {
    if (root) {
      const r = root;
      root = null;
      await act(async () => {
        r.unmount();
      });
    }
  });

  it('three chips start unpressed and toggle independently', async () => {
    expect(chips().length).toBe(3);
    expect(pressed()).toEqual(['false', 'false', 'false']);

    await click(chips()[0]);
    expect(pressed()).toEqual(['true', 'false', 'false']);

    await click(chips()[1]);
    // Multi-select: the first pick stays pressed.
    expect(pressed()).toEqual(['true', 'true', 'false']);

    await click(chips()[0]);
    expect(pressed()).toEqual(['false', 'true', 'false']);
  });

  it('the send hands the picked labels to onSend and resets the row', async () => {
    const ta = dom.document.querySelector('textarea') as FakeElement;
    ta.value = '她还喜欢我吗';
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !b.classList.contains('input-stop'),
    )!;
    await click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('她还喜欢我吗', ['只能发短信']);
    // 本轮约束 is per-turn: the row clears after the send.
    expect(pressed()).toEqual(['false', 'false', 'false']);
  });

  it('the chips row fits its column (scrollWidth <= clientWidth)', () => {
    const row = dom.document.querySelector('.constraint-chips') as FakeElement;
    expect(row).toBeTruthy();
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    // And it never shares the tool row's element.
    expect(row.classList.contains('input-tools')).toBe(false);
  });
});

describe('P407 · assistant bubble 已按约束 header', () => {
  const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'a-1',
    role: 'assistant',
    content: '先肯定她的感受，再给一句可以直接发的话。',
    createdAt: 1,
    ...over,
  });

  const render = (message: ChatMessage) =>
    renderToStaticMarkup(createElement(MessageBubble, { message }));

  it('renders the dim line atop the bubble when the turn had chips', () => {
    const html = render(assistant({ constraints: ['我不想主动'] }));
    expect(html).toContain('constraint-note');
    expect(html).toContain('已按约束：不想主动');
    // The header sits before the reply body inside the bubble.
    expect(html.indexOf('constraint-note')).toBeLessThan(
      html.indexOf('bubble-content'),
    );
  });

  it('joins multiple picks with 、 and hides entirely with none', () => {
    const html = render(
      assistant({ constraints: ['我不想主动', '只能发短信'] }),
    );
    expect(html).toContain('已按约束：不想主动、只能发短信');
    expect(render(assistant())).not.toContain('已按约束');
    expect(render(assistant({ constraints: [] }))).not.toContain(
      'constraint-note',
    );
  });

  it('survives the storage round trip (serializeMessages keeps metadata)', () => {
    const stored = serializeMessages([
      assistant({ constraints: ['我不想主动', '预算有限'] }),
    ]);
    expect(stored[0]?.constraints).toEqual(['我不想主动', '预算有限']);
    // Re-rendered from restored metadata the line still shows.
    expect(render(stored[0]!)).toContain('已按约束：不想主动、预算有限');
    // Unconstrained replies persist nothing extra.
    expect(serializeMessages([assistant()])[0]).not.toHaveProperty(
      'constraints',
    );
  });
});
