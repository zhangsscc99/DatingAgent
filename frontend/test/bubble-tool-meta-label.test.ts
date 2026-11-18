/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';
import { toolDisplayName, TOOL_LABELS } from '../src/lib/toolLabels';
import {
  normalizeStoredSessions,
  serializeMessages,
} from '../src/lib/chatStorage';

/**
 * P239 — the finished assistant bubble's meta line used to render the raw
 * internal tool id (`coach_conversation`, `get_relationship_advice`) next to
 * the Chinese badge and the latency; after a hard refresh the id disappeared
 * (the persisted message simply lacks `meta.tool`), which proved it was a
 * render-layer leak, not a contract field. No `[a-z]+_[a-z_]+` identifier
 * can reach bubble text.
 *
 * P258 — the meta line then repeated the badge's Chinese tool name a second
 * time inside the same bubble. The meta row no longer renders a tool label
 * at all: the badge inside the bubble already carries the name, so
 * 「接话术」 appears exactly once per bubble and never inside
 * `.reply-meta`. The same round also made the latency number unconditional —
 * a slow tool reply keeps its numeric seconds plus a short clause instead of
 * the vague 「本次思考较久」. Mounted on the fake DOM (same approach as
 * bubble-copy-role-copy.test.ts).
 *
 * P304 — the visible 「约 X 秒」 badge left the body hierarchy: the meta row
 * now shows the reply's age (「刚刚」 for a fresh reply) while the exact
 * seconds and token count survive only in the element's title tooltip.
 */

const SNAKE_ID = /[a-z]+_[a-z_]+/;
const NOW = Date.now();

const KNOWN: ChatMessage = {
  id: 'a-known',
  role: 'assistant',
  content: '可以先接住她的表情包，再顺着约咖啡。',
  createdAt: NOW,
  toolEvents: [
    { name: 'coach_conversation', label: '接话术', status: 'done' },
  ],
  meta: { tool: 'coach_conversation', tokens: 120, latencyMs: 8800 },
};

const UNKNOWN: ChatMessage = {
  id: 'a-unknown',
  role: 'assistant',
  content: '关系建议正文。',
  createdAt: NOW,
  meta: { tool: 'mystery_backend_tool', tokens: 60, latencyMs: 4100 },
};

const NOTOOL: ChatMessage = {
  id: 'a-notool',
  role: 'assistant',
  content: '普通回复。',
  createdAt: NOW,
  meta: { tokens: 40, latencyMs: 2000 },
};

/** P258 — a slow tool round: badge on top, meta row under the reply. */
const SLOW: ChatMessage = {
  id: 'a-slow',
  role: 'assistant',
  content: '慢回复正文。',
  createdAt: NOW,
  toolEvents: [
    { name: 'coach_conversation', label: '接话术', status: 'done' },
  ],
  meta: { tool: 'coach_conversation', tokens: 300, latencyMs: 25_400 },
};

/**
 * P243 — what a hard reload hands back to the bubble: serialize → JSON →
 * normalise. The restored message must render a meta row byte-identical to
 * the in-session one, still without a tool name, a raw id, or the word
 * `tokens` in visible text (P212).
 */
const RESTORED: ChatMessage = normalizeStoredSessions([
  {
    id: 's1',
    title: '对话',
    updatedAt: 1,
    messages: JSON.parse(JSON.stringify(serializeMessages([KNOWN]))),
  },
])[0].messages[0];

describe('P258 · bubble meta never repeats the tool name', () => {
  let dom: FakeDom;

  const metaRows = () =>
    Array.from(dom.document.querySelectorAll('.reply-meta')) as FakeElement[];
  const bubbleRows = () =>
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
          createElement(MessageBubble, { message: KNOWN }),
          createElement(MessageBubble, { message: UNKNOWN }),
          createElement(MessageBubble, { message: NOTOOL }),
          createElement(MessageBubble, { message: RESTORED }),
          createElement(MessageBubble, { message: SLOW }),
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(() => {
    // fake DOM is process-global; nothing persistent to tear down
  });

  it('the badge says the tool name once and the meta line never repeats it', () => {
    const bubble = bubbleRows()[0];
    const occurrences = (bubble.textContent.match(/接话术/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(bubble.querySelector('.tool-badge'), 'tool badge').toBeTruthy();

    const row = metaRows()[0];
    expect(row, 'meta row').toBeTruthy();
    expect(row.textContent).not.toContain('接话术');
    expect(row.textContent).not.toContain('coach_conversation');
    expect(SNAKE_ID.test(row.textContent)).toBe(false);
    // P304: the visible badge is the reply's age; exact latency rides in
    // the title tooltip with the token count.
    expect(row.textContent).toBe('刚刚');
    expect(row.textContent).not.toMatch(/约 [\d.]+ 秒/);
    expect(row.getAttribute('title')).toBe('120 tokens · 8.8s');
  });

  it('no meta row carries any tool display name or meta-tool element', () => {
    expect(metaRows()).toHaveLength(5);
    for (const row of metaRows()) {
      for (const name of Object.values(TOOL_LABELS)) {
        expect(row.textContent).not.toContain(name);
      }
      expect(row.querySelector('.reply-meta-tool')).toBeNull();
    }
  });

  it('an unmapped tool id renders no snake_case identifier at all', () => {
    const row = metaRows()[1];
    expect(row, 'meta row').toBeTruthy();
    expect(row.textContent).not.toContain('mystery_backend_tool');
    expect(SNAKE_ID.test(row.textContent)).toBe(false);
    expect(row.querySelector('.reply-meta-tool')).toBeNull();
  });

  it('a restored message renders the identical meta row — no tool name, no raw id, no tokens', () => {
    const restored = metaRows()[3];
    expect(restored, 'restored meta row').toBeTruthy();
    // identical to the in-session line
    expect(restored.textContent).toBe(metaRows()[0].textContent);
    expect(restored.textContent).not.toContain('接话术');
    expect(restored.getAttribute('title')).toBe(metaRows()[0].getAttribute('title'));
    expect(restored.textContent).not.toContain('coach_conversation');
    expect(restored.textContent).not.toContain('tokens');
    expect(SNAKE_ID.test(restored.textContent)).toBe(false);
    // and the persisted meta really did survive the round trip
    expect(RESTORED.meta).toEqual(KNOWN.meta);
  });

  it('a slow reply keeps its exact seconds in the tooltip — still no tool name', () => {
    const row = metaRows()[4];
    expect(row, 'slow meta row').toBeTruthy();
    expect(row.textContent).toBe('刚刚');
    expect(row.textContent).not.toMatch(/约 [\d.]+ 秒/);
    expect(row.textContent).not.toContain('想了有一会儿');
    expect(row.getAttribute('title')).toBe('300 tokens · 25.4s');
    expect(row.textContent).not.toBe('本次思考较久');
    expect(row.textContent).not.toContain('接话术');
    // and its bubble still says the name exactly once, in the badge
    const bubble = bubbleRows()[4];
    expect((bubble.textContent.match(/接话术/g) ?? []).length).toBe(1);
  });

  it('toolDisplayName maps known ids and returns undefined otherwise', () => {
    expect(toolDisplayName('coach_conversation')).toBe('接话术');
    expect(toolDisplayName('get_relationship_advice')).toBe('关系建议');
    expect(toolDisplayName('plan_date')).toBe('排约会');
    expect(toolDisplayName('analyze_profile')).toBe('改资料');
    expect(toolDisplayName('check_compatibility')).toBe('看匹配');
    expect(toolDisplayName('mystery_backend_tool')).toBeUndefined();
  });
});
