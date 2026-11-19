/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  jsonResponse,
  FakeEvent,
  FakeElement,
  type FakeDom,
} from './helpers/fakeDom';
import {
  loadChatState,
  syncSessionWithBackend,
  type ChatStorageState,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P359 — the other half of the restart defect: when the session id the
 * browser holds is missing on the server (404), the app used to silently
 * re-pin it and behave like nothing happened — or, with a wiped local
 * store, render the new-user empty state. A dismissible 「上次的对话未保存」
 * notice now tells the truth. A 5xx or a dead socket is NOT data loss and
 * must not raise it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const userMsg = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 1_000,
});
const assistantMsg = (id: string, content: string): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: 1_001,
});

function seededState(id: string, messages: ChatMessage[]): ChatStorageState {
  return {
    activeSessionId: id,
    sessions: [{ id, title: '旧会话', updatedAt: 10, messages }],
  };
}

describe('P359 · syncSessionWithBackend reports what the server holds', () => {
  const calls: string[] = [];
  const stubFetch = (handler: (url: string, init?: unknown) => unknown) => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
        calls.push(url);
        return handler(url, init);
      }),
    );
  };

  it('a 2xx check means present — no restore call', async () => {
    stubFetch(() => jsonResponse({ sessionId: 's1', history: [] }));
    const result = await syncSessionWithBackend('s1', [userMsg('u1', '你好')]);
    expect(result).toBe('present');
    expect(calls).toEqual(['/api/session/s1']);
  });

  it('a 404 check means missing — the stored copy is re-pinned via restore', async () => {
    stubFetch((url) =>
      url === '/api/session/restore'
        ? jsonResponse({ sessionId: 's1', restored: true })
        : { ok: false, status: 404, headers: { get: () => null }, body: null },
    );
    const result = await syncSessionWithBackend('s1', [
      userMsg('u1', '她说最近有点累'),
      assistantMsg('a1', '嗯'),
    ]);
    expect(result).toBe('missing');
    expect(calls).toEqual(['/api/session/s1', '/api/session/restore']);
  });

  it('a network throw is unreachable — never reported as data loss', async () => {
    stubFetch(() => {
      throw new Error('socket hangup');
    });
    const result = await syncSessionWithBackend('s1', [userMsg('u1', '你好')]);
    expect(result).toBe('unreachable');
  });

  it('a 5xx is unreachable — the server cannot answer, the copy may still exist', async () => {
    stubFetch(() => ({ ok: false, status: 503, headers: { get: () => null }, body: null }));
    const result = await syncSessionWithBackend('s1', [userMsg('u1', '你好')]);
    expect(result).toBe('unreachable');
  });
});

describe('P359 · the notice surfaces a missing server session', () => {
  let dom: FakeDom;
  let sessionCheckOk = false;
  let root: Root | null = null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);

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
    if (!root) return;
    const r = root;
    root = null;
    await act(async () => {
      r.unmount();
    });
  };

  beforeAll(() => {
    dom = installFakeDom();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') return jsonResponse({ status: 'ok', llmConfigured: true });
        if (url === '/api/session/restore') {
          return jsonResponse({ sessionId: 's-lost', restored: true, messageCount: 2 });
        }
        if (url.startsWith('/api/session/')) {
          return sessionCheckOk
            ? jsonResponse({ sessionId: 's-lost', history: [], memory: { count: 0, items: [] } })
            : { ok: false, status: 404, headers: { get: () => null }, body: null };
        }
        return jsonResponse({});
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(async () => {
    await unmountApp();
    vi.unstubAllGlobals();
  });

  const seed = () =>
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify(
        seededState('s-lost', [userMsg('u1', '她想周末见面'), assistantMsg('a1', '去哪儿？')]),
      ),
    );

  it('mount restore on a 404 shows 「上次的对话未保存」, dismissible', async () => {
    sessionCheckOk = false;
    seed();
    await mountApp();

    const notice = qs('.session-lost-notice');
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain('上次的对话未保存');

    // The stored bubbles still render — the notice reports, it does not wipe.
    expect(dom.document.querySelectorAll('.bubble').length).toBeGreaterThan(0);

    const closeBtn = qs('.session-lost-notice-close') as FakeElement;
    await act(async () => {
      closeBtn.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(qs('.session-lost-notice')).toBeNull();

    await unmountApp();
  });

  it('a healthy server copy shows no notice', async () => {
    sessionCheckOk = true;
    seed();
    await mountApp();
    expect(qs('.session-lost-notice')).toBeNull();
    await unmountApp();
  });

  it('fresh state without a stored session shows no notice', async () => {
    sessionCheckOk = false;
    dom.localStorage.clear();
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
    await mountApp();
    expect(qs('.session-lost-notice')).toBeNull();
    await unmountApp();
  });

  it('the copy and hooks live in App.tsx / App.css — plain words, status role', () => {
    const app = read('App.tsx');
    expect(app).toContain('上次的对话未保存');
    expect(app).toContain('session-lost-notice');
    expect(app).toContain("result === 'missing'");
    const noticeBlock = app.slice(app.indexOf('session-lost-notice'));
    expect(noticeBlock).toContain('role="status"');
    expect(noticeBlock).toContain('aria-label="关闭提示"');

    const css = read('App.css');
    expect(css).toContain('.session-lost-notice {');
    expect(css).toContain('.session-lost-notice-close');
  });
});
