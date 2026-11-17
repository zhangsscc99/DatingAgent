/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';
import { toolDisplayName } from '../src/lib/toolLabels';
import {
  normalizeStoredSessions,
  serializeMessages,
} from '../src/lib/chatStorage';

/**
 * P239 — the finished assistant bubble's meta line used to render the raw
 * internal tool id (`coach_conversation`, `get_relationship_advice`) next to
 * the Chinese badge and the latency; after a hard refresh the id disappeared
 * (the persisted message simply lacks `meta.tool`), which proved it was a
 * render-layer leak, not a contract field. The meta line now goes through
 * `toolDisplayName`: a known id renders its Chinese name, an unmapped id
 * renders nothing — no `[a-z]+_[a-z_]+` identifier can reach bubble text.
 * Mounted on the fake DOM (same approach as bubble-copy-role-copy.test.ts).
 */

const SNAKE_ID = /[a-z]+_[a-z_]+/;

const KNOWN: ChatMessage = {
  id: 'a-known',
  role: 'assistant',
  content: '可以先接住她的表情包，再顺着约咖啡。',
  createdAt: 1,
  meta: { tool: 'coach_conversation', tokens: 120, latencyMs: 8800 },
};

const UNKNOWN: ChatMessage = {
  id: 'a-unknown',
  role: 'assistant',
  content: '关系建议正文。',
  createdAt: 2,
  meta: { tool: 'mystery_backend_tool', tokens: 60, latencyMs: 4100 },
};

const NOTOOL: ChatMessage = {
  id: 'a-notool',
  role: 'assistant',
  content: '普通回复。',
  createdAt: 3,
  meta: { tokens: 40, latencyMs: 2000 },
};

/**
 * P243 — what a hard reload hands back to the bubble: serialize → JSON →
 * normalise. The restored message must render a meta row byte-identical to
 * the in-session one, still through toolDisplayName (never the raw id) and
 * still without the word `tokens` in visible text (P212).
 */
const RESTORED: ChatMessage = normalizeStoredSessions([
  {
    id: 's1',
    title: '对话',
    updatedAt: 1,
    messages: JSON.parse(JSON.stringify(serializeMessages([KNOWN]))),
  },
])[0].messages[0];

describe('P239 · bubble meta never renders a raw tool id', () => {
  let dom: FakeDom;

  const metaRows = () =>
    Array.from(dom.document.querySelectorAll('.reply-meta')) as FakeElement[];

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
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(() => {
    // fake DOM is process-global; nothing persistent to tear down
  });

  it('a known tool id renders its Chinese name, never the raw id', () => {
    const row = metaRows()[0];
    expect(row, 'meta row').toBeTruthy();
    expect(row.textContent).toContain('聊天指导');
    expect(row.textContent).not.toContain('coach_conversation');
    expect(SNAKE_ID.test(row.textContent)).toBe(false);
    // latency still renders alongside the label
    expect(row.textContent).toMatch(/秒/);
  });

  it('an unmapped tool id renders no snake_case identifier at all', () => {
    const row = metaRows()[1];
    expect(row, 'meta row').toBeTruthy();
    expect(row.textContent).not.toContain('mystery_backend_tool');
    expect(SNAKE_ID.test(row.textContent)).toBe(false);
    expect(row.querySelector('.reply-meta-tool')).toBeNull();
  });

  it('a restored message renders the identical meta row — Chinese name, no raw id, no tokens', () => {
    const restored = metaRows()[3];
    expect(restored, 'restored meta row').toBeTruthy();
    // identical to the in-session line
    expect(restored.textContent).toBe(metaRows()[0].textContent);
    expect(restored.textContent).toContain('聊天指导');
    expect(restored.textContent).toContain('秒');
    expect(restored.textContent).not.toContain('coach_conversation');
    expect(restored.textContent).not.toContain('tokens');
    expect(SNAKE_ID.test(restored.textContent)).toBe(false);
    // and the persisted meta really did survive the round trip
    expect(RESTORED.meta).toEqual(KNOWN.meta);
  });

  it('toolDisplayName maps known ids and returns undefined otherwise', () => {
    expect(toolDisplayName('coach_conversation')).toBe('聊天指导');
    expect(toolDisplayName('get_relationship_advice')).toBe('关系建议');
    expect(toolDisplayName('plan_date')).toBe('约会规划');
    expect(toolDisplayName('analyze_profile')).toBe('资料优化');
    expect(toolDisplayName('check_compatibility')).toBe('匹配分析');
    expect(toolDisplayName('mystery_backend_tool')).toBeUndefined();
  });
});
