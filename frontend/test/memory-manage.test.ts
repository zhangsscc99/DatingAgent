/// <reference types="node" />
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, act, useEffect, useState } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import {
  fetchConversationMemory,
  forgetConversationMemory,
  removeMemoryFact,
} from '../src/lib/conversationMemory';
import type { ChatMessage, ConversationMemory, MemoryFact } from '../src/types';

/**
 * P339 — the memory capsule used to be read-only and locally derived:
 * a deletion lived only in `datingagent.memoryDismissals` on the client,
 * and nothing could list or forget a single remembered fact. The capsule
 * now lists the server-held memory (P351: a 记得 N 件事 lead + the first
 * 3 facts as pills + a 「+N」 chip), expands into the full list, and each
 * row carries 「忘记这条」 wired to
 * DELETE /api/conversations/:id/memory/:key — the fact stays gone after a
 * refresh because the deletion is persisted server-side.
 */

const noop = () => {};

const turns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '她说最近有点累，我是不是不该约了？' },
  { id: 'a1', role: 'assistant', content: '先接住她的状态，再谈安排。' },
  { id: 'u2', role: 'user', content: '我明天第一次约会' },
];

/** Five keyed facts — past the first-3 threshold so 「共 N 条」 shows. */
function seedFacts(): MemoryFact[] {
  return [
    { key: '她最近有点累', text: '她最近有点累', ts: 1 },
    { key: '我明天第一次约会', text: '我明天第一次约会', ts: 2 },
    { key: '没睡好', text: '没睡好', ts: 3 },
    { key: '带闺蜜', text: '带闺蜜', ts: 4 },
    { key: '三个小时没回', text: '三个小时没回', ts: 5 },
  ];
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * A tiny in-memory stand-in for the two memory endpoints — enough of the
 * server contract to drive the component the way App.tsx drives it.
 */
function fakeMemoryApi(sessionId: string, store: { items: MemoryFact[] }) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchSpy = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const getMatch = new RegExp(
      `^/api/conversations/${sessionId}/memory$`,
    ).exec(url);
    if (getMatch && method === 'GET') {
      return Promise.resolve(
        jsonResponse({ count: store.items.length, items: store.items }),
      );
    }
    const delMatch = new RegExp(
      `^/api/conversations/${sessionId}/memory/(.+)$`,
    ).exec(url);
    if (delMatch && method === 'DELETE') {
      const key = decodeURIComponent(delMatch[1]);
      const before = store.items.length;
      store.items = store.items.filter((f) => f.key !== key);
      const deleted = store.items.length < before;
      return Promise.resolve(
        jsonResponse({ deleted }, deleted, deleted ? 200 : 404),
      );
    }
    return Promise.resolve(jsonResponse({ error: 'Not found' }, false, 404));
  });
  return { fetchSpy, calls };
}

/** Replicates App.tsx's wiring: fetch memory on mount, forget on click. */
function Harness({ sessionId }: { sessionId: string }) {
  const [memory, setMemory] = useState<ConversationMemory | null>(null);
  useEffect(() => {
    let live = true;
    void fetchConversationMemory(sessionId).then((m) => {
      if (live) setMemory(m);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);
  return createElement(ChatWindow, {
    messages: turns,
    loading: false,
    onSend: noop,
    profile: null,
    sessionId,
    memory: memory ?? undefined,
    onForgetMemory: (key: string) => {
      void forgetConversationMemory(sessionId, key).then((ok) => {
        if (ok) {
          setMemory((prev) => (prev ? removeMemoryFact(prev, key) : prev));
        }
      });
    },
  });
}

describe('P339 · capsule shows the server memory: count lead + pills', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the collapsed capsule leads with 记得 5 件事, shows the first 3 facts as pills and a +2 chip', () => {
    const memory: ConversationMemory = { count: 5, items: seedFacts() };
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: turns,
        loading: false,
        onSend: noop,
        profile: null,
        sessionId: 's-mem',
        memory,
        onForgetMemory: noop,
      }),
    );
    // P351: the count lead is always visible — it can never be ellipsised.
    expect(markup).toContain('记得 5 件事');
    // The first three facts render as individual pills.
    expect(markup.match(/data-fact="true"/g)).toHaveLength(3);
    for (const label of ['她最近有点累', '我明天第一次约会', '没睡好']) {
      expect(markup).toContain(`class="memory-capsule-fact"`);
      expect(markup).toContain(label);
    }
    // Facts 4/5 stay behind the expand affordance — counted by +2.
    expect(markup).toContain('memory-capsule-more');
    expect(markup).toContain('+2');
    expect(markup).not.toContain('带闺蜜');
    expect(markup).not.toContain('三个小时没回');
  });

  it('exactly 3 facts shows 记得 3 件事 and no +N chip', () => {
    const memory: ConversationMemory = {
      count: 3,
      items: seedFacts().slice(0, 3),
    };
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: turns,
        loading: false,
        onSend: noop,
        profile: null,
        sessionId: 's-mem',
        memory,
        onForgetMemory: noop,
      }),
    );
    expect(markup).toContain('记得 3 件事');
    expect(markup.match(/data-fact="true"/g)).toHaveLength(3);
    expect(markup).not.toContain('memory-capsule-more');
  });
});

describe('P339 · expand, forget, and the fact stays gone after refresh', () => {
  const SESSION = 's-mem-manage';
  let dom: FakeDom;
  let root: Root | null = null;
  let store: { items: MemoryFact[] };
  let api: ReturnType<typeof fakeMemoryApi>;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const click = async (el: FakeElement | null) => {
    expect(el, 'click target').toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  async function mountHarness() {
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    const nextRoot = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      nextRoot.render(createElement(Harness, { sessionId: SESSION }));
    });
    await flush();
    return nextRoot;
  }

  afterAll(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    vi.unstubAllGlobals();
  });

  it('the whole lifecycle: load → expand → forget → refresh still gone', async () => {
    dom = installFakeDom();
    store = { items: seedFacts() };
    api = fakeMemoryApi(SESSION, store);
    vi.stubGlobal('fetch', api.fetchSpy);

    root = await mountHarness();

    // Memory arrived — the capsule expanded lists every remembered fact.
    const capsule = qs('.memory-capsule');
    expect(capsule).toBeTruthy();
    expect(qs('.memory-panel')).toBeNull();
    await click(capsule);

    const rows = qsa('.memory-panel-row');
    expect(rows).toHaveLength(store.items.length);
    const forgetButtons = qsa('.memory-panel-forget');
    expect(forgetButtons).toHaveLength(store.items.length);
    for (const btn of forgetButtons) {
      expect((btn as FakeElement).getAttribute('aria-label')).toContain('忘记这条');
      expect((btn as FakeElement).textContent).toBe('忘记这条');
    }

    // Forget 她最近有点累 — the DELETE hits the keyed endpoint and the row
    // disappears from both the panel and the capsule line.
    const target = forgetButtons.find((b) =>
      (b as FakeElement).getAttribute('aria-label')!.includes('她最近有点累'),
    ) as FakeElement;
    await click(target);

    expect(
      api.calls.some(
        (c) =>
          c.method === 'DELETE' &&
          c.url ===
            `/api/conversations/${SESSION}/memory/${encodeURIComponent('她最近有点累')}`,
      ),
    ).toBe(true);
    expect(qsa('.memory-panel-row')).toHaveLength(4);
    expect(qs('.memory-capsule-text')!.textContent).not.toContain('她最近有点累');
    // P351: the count lead updates — 4 facts now, so +1 sits behind it.
    expect(qs('.memory-capsule-text')!.textContent).toContain('记得 4 件事');
    expect(qs('.memory-capsule-more')!.textContent).toBe('+1');

    // Refresh: remount — the fake backend no longer holds the fact, so the
    // capsule can never re-derive it.
    await act(async () => {
      root!.unmount();
    });
    root = await mountHarness();
    await click(qs('.memory-capsule'));
    expect(qsa('.memory-panel-row')).toHaveLength(4);
    const labels = qsa('.memory-panel-text').map((el) => el.textContent);
    expect(labels).not.toContain('她最近有点累');
    expect(qs('.memory-capsule-text')!.textContent).not.toContain('她最近有点累');
  });
});
