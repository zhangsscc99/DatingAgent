/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  ControlledSseStream,
  FakeElement,
  FakeEvent,
  installFakeDom,
  jsonResponse,
  sse,
  sseResponse,
  type FakeDom,
} from './helpers/fakeDom';
import {
  STARTERS,
  assembleStarterMessage,
} from '../src/lib/starterIntents';
import type { ChatIntent } from '../src/types';

/**
 * P345 — the welcome starter capsules used to be dead options: each
 * click just prefilled a fixed sentence, so picking one was identical to
 * typing it (and the request carried no signal at all). They are now
 * structural branches — a chip opens its own intake (缺哪项资料 / 她的
 * 原话 / 城市·预算·第几次), assembles a per-branch first message into the
 * composer, and the send carries that branch's `intent` on /api/chat.
 * P355: the chips render the shared STARTER_ENTRIES labels (the drawer
 * copy), so the scenario labels below are the sentence-shaped ones.
 *
 * Mounted-App assertions on the fake DOM (same harness as
 * sidebar-tool-entries.test.ts): three different intake shapes, three
 * pairwise-different prefills, three pairwise-different intents.
 */

interface Scenario {
  label: string;
  intent: ChatIntent;
  /** Drive the intake's fields to a submittable state. */
  fill: (panel: FakeElement, helpers: Helpers) => Promise<void>;
  /** Substring the assembled draft must contain. */
  expectInDraft: string;
}

interface Helpers {
  click: (el: FakeElement | null | undefined) => Promise<void>;
  type: (el: FakeElement | null | undefined, value: string) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  {
    label: '帮我优化资料',
    intent: 'profile',
    fill: async (panel, { click }) => {
      const option = panel
        .querySelectorAll('.starter-intake-option')
        .find((b) => b.textContent === '自我介绍');
      await click(option);
    },
    expectInDraft: '自我介绍',
  },
  {
    label: '她这样回我怎么接',
    intent: 'chat-coach',
    fill: async (panel, { type }) => {
      await type(panel.querySelector('.starter-intake-textarea'), '嗯，随便你吧');
    },
    expectInDraft: '嗯，随便你吧',
  },
  {
    label: '帮我规划第一次约会',
    intent: 'date-plan',
    fill: async (panel, { type }) => {
      const city = panel
        .querySelectorAll('input')
        .find((i) => i.getAttribute('aria-label') === '城市');
      await type(city, '上海');
    },
    expectInDraft: '上海',
  },
];

describe('P345 · starter capsules are structural branches (mounted App)', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  let stream: ControlledSseStream;
  const chatBodies: Array<Record<string, unknown>> = [];
  const drafted: Partial<Record<ChatIntent, string>> = {};

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const type = async (el: FakeElement | null | undefined, value: string) => {
    if (!el) throw new Error('input target missing');
    el.value = value;
    await act(async () => {
      el.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
  };

  const install = () => {
    dom = installFakeDom(); // matchMedia matches nothing → desktop, chips render
    stream = new ControlledSseStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { body?: string }) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/chat/stream') {
          chatBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
          return sseResponse(stream);
        }
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') return jsonResponse({ status: 'ok' });
        return jsonResponse({ ok: true });
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  };

  const mountApp = async () => {
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  /** Drain the parked stream so the turn settles before unmount. */
  const finishStream = async () => {
    await act(async () => {
      stream.push(
        sse('delta', { content: '收到。' }),
        sse('message', { content: '收到。', role: 'assistant' }),
        sse('done', { sessionId: 'test-session' }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const scenario of SCENARIOS) {
    it(`clicking 「${scenario.label}」 opens its own intake and sends intent=${scenario.intent}`, async () => {
      install();
      await mountApp();
      const sentBefore = chatBodies.length;

      // The chip toggles its intake open — no more cosmetic prefill.
      const chip = dom.document
        .querySelectorAll('.starter-chip')
        .find((b) => b.getAttribute('aria-label') === scenario.label);
      await click(chip);
      const panel = qs('.starter-intake');
      expect(panel, 'intake panel').not.toBeNull();
      expect(chip!.getAttribute('aria-expanded')).toBe('true');
      // The composer is NOT prefilled by the click alone.
      expect((qs('#chat-input') as FakeElement).value).toBe('');

      // Required-field gating: nothing assembles until the branch has input.
      const fillBtn = qs('.starter-intake-fill') as FakeElement;
      expect(fillBtn).not.toBeNull();
      expect(fillBtn.disabled).toBe(true);

      await scenario.fill(panel!, { click, type });
      await flush();
      expect(fillBtn.disabled).toBe(false);
      await click(fillBtn);

      // The assembled first message lands in the composer — prefill, not send.
      const draft = (qs('#chat-input') as FakeElement).value;
      expect(draft).toContain(scenario.expectInDraft);
      expect(qs('.starter-intake')).toBeNull(); // intake closed after fill
      expect(chatBodies).toHaveLength(sentBefore); // nothing dispatched yet
      drafted[scenario.intent] = draft;

      // Sending carries this branch's intent on the chat request.
      const send = dom.document
        .querySelectorAll('.input-send')
        .find((b) => !b.classList.contains('input-stop')) as FakeElement;
      await click(send);
      await flush();
      const sent = chatBodies.at(-1);
      expect(sent).toBeTruthy();
      expect(sent!.intent).toBe(scenario.intent);
      expect(sent!.message).toBe(draft);

      await finishStream();
      await unmountApp();
    });
  }

  it('each intake branch has its own field shape', async () => {
    install();
    await mountApp();
    const chips = dom.document.querySelectorAll('.starter-chip');
    // P355: four chips — the whole shared STARTER_ENTRIES list renders.
    expect(chips).toHaveLength(4);

    const shapeOf = async (label: string) => {
      await click(chips.find((b) => b.getAttribute('aria-label') === label));
      const panel = qs('.starter-intake');
      const shape = {
        options: panel?.querySelectorAll('.starter-intake-option').length ?? 0,
        textarea: panel?.querySelector('.starter-intake-textarea') !== null,
        fields: panel?.querySelectorAll('.starter-intake-field').length ?? 0,
      };
      await click(qs('.starter-intake-cancel'));
      return shape;
    };

    const profile = await shapeOf('帮我优化资料');
    const coach = await shapeOf('她这样回我怎么接');
    const date = await shapeOf('帮我规划第一次约会');

    expect(profile.options).toBeGreaterThanOrEqual(3);
    expect(profile.textarea).toBe(false);
    expect(profile.fields).toBe(0);

    expect(coach.textarea).toBe(true);
    expect(coach.options).toBe(0);
    expect(coach.fields).toBe(0);

    expect(date.fields).toBe(3);
    expect(date.options).toBe(0);
    expect(date.textarea).toBe(false);

    await unmountApp();
  });

  it('the three starters produce pairwise different prefills and intents', () => {
    const intents = SCENARIOS.map((s) => s.intent);
    for (let i = 0; i < intents.length; i += 1) {
      for (let j = i + 1; j < intents.length; j += 1) {
        const a = drafted[intents[i]];
        const b = drafted[intents[j]];
        expect(a, intents[i]).toBeTruthy();
        expect(b, intents[j]).toBeTruthy();
        expect(a, `${intents[i]} vs ${intents[j]} prefill`).not.toBe(b);
      }
    }
    // The intents themselves are pairwise different and match the starter.
    const sentIntents = chatBodies
      .filter((b) => b.intent !== undefined)
      .map((b) => b.intent);
    expect(sentIntents).toEqual(['profile', 'chat-coach', 'date-plan']);
  });

  it('a hand-typed first message sends no intent', async () => {
    install();
    await mountApp();
    const ta = qs('#chat-input') as FakeElement;
    await type(ta, '直接打字进来的问题');
    const send = dom.document
      .querySelectorAll('.input-send')
      .find((b) => !b.classList.contains('input-stop')) as FakeElement;
    await click(send);
    await flush();
    const sent = chatBodies.at(-1);
    expect(sent!.message).toBe('直接打字进来的问题');
    expect(sent!.intent).toBeUndefined();
    await finishStream();
    await unmountApp();
  });
});

describe('P345 · assembleStarterMessage', () => {
  it('returns null until the required field is filled', () => {
    expect(assembleStarterMessage('profile', {})).toBeNull();
    expect(assembleStarterMessage('profile', { missing: ' ' })).toBeNull();
    expect(assembleStarterMessage('chat-coach', { herWords: '  ' })).toBeNull();
    expect(assembleStarterMessage('date-plan', { city: '' })).toBeNull();
  });

  it('assembles one message per branch from its fields', () => {
    const texts = [
      assembleStarterMessage('profile', { missing: '照片' }),
      assembleStarterMessage('chat-coach', { herWords: '在忙' }),
      assembleStarterMessage('date-plan', {
        city: '杭州',
        budget: '200',
        ordinal: '第二次',
      }),
    ];
    for (const text of texts) expect(text).toBeTruthy();
    expect(new Set(texts).size).toBe(3);
  });

  it('keeps the three starter intents aligned with the backend contract', () => {
    expect(STARTERS.map((s) => s.intent)).toEqual([
      'profile',
      'chat-coach',
      'date-plan',
    ]);
  });
});
