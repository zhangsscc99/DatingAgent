/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  installFakeDom,
  ControlledSseStream,
  sseResponse,
  jsonResponse,
  sse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { loadChatState } from '../src/lib/chatStorage';
import { needsReply, pendingReplyPrompt } from '../src/lib/pendingReply';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P253 — the other half of the refresh-during-generation defect: a
 * conversation restored from localStorage can end on a bare user message
 * (the reply never landed). The restore must show that message normally
 * plus a quiet 「重新发送」 action that re-issues the exact same text
 * through the normal streaming path — never a stuck spinner and never the
 * transient placeholder copy as message content.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';
const U1 = '我们周五晚上去哪儿好？';
const A1 = '先定氛围：想安静聊天还是热闹一点？';
const U2 = '她想安静一点，咖啡馆还是茶馆？';
const A2 = '咖啡馆靠窗的位置最稳。';

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

function seedSession(messages: ChatMessage[], id = 's-restore') {
  const state = {
    activeSessionId: id,
    sessions: [{ id, title: messages[0]?.content ?? '会话', updatedAt: 10, messages }],
  };
  return state;
}

describe('P253 · an interrupted turn restores with a resend affordance', () => {
  let dom: FakeDom;
  let stream: ControlledSseStream;
  let chatBodies: Array<Record<string, unknown>>;
  let root: Root | null = null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const bubbles = () => qsa('.bubble');

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

  beforeAll(async () => {
    dom = installFakeDom();
    chatBodies = [];
    stream = new ControlledSseStream();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/chat/stream') {
          chatBodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
          return sseResponse(stream);
        }
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        if (url === '/api/session/restore') {
          return jsonResponse({ sessionId: 's-restore', restored: true });
        }
        if (url.startsWith('/api/session/')) {
          // The backend copy is gone (restart / TTL) → the app re-pins it
          // through /api/session/restore below.
          return { ok: false, status: 404, headers: { get: () => null }, body: null };
        }
        return jsonResponse({});
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('restore shows the stored user message plus 「重新发送」, which resends the same text', async () => {
    dom.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        seedSession([userMsg('u1', U1), assistantMsg('a1', A1), userMsg('u2', U2)]),
      ),
    );
    await mountApp();

    // The restored conversation renders normally: both bubbles present,
    // no spinner standing in for the lost reply.
    const texts = bubbles().map((b) => b.textContent);
    expect(texts.join('')).toContain(U1);
    expect(texts.join('')).toContain(A1);
    expect(texts.join('')).toContain(U2);
    expect(qsa('.bubble').some((b) => b.textContent.includes('正在生成'))).toBe(false);

    const row = qs('.pending-reply-row');
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain('这次没等到回复');
    const btn = qs('.pending-reply-btn') as FakeElement;
    expect(btn.textContent).toContain('重新发送');
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();

    // The resend re-issues the exact stored text through the normal stream
    // path — same session, same tool routing, no second user bubble.
    expect(chatBodies).toHaveLength(1);
    expect(chatBodies[0].sessionId).toBe('s-restore');
    expect(chatBodies[0].message).toBe(U2);

    // The row is gone while the reply streams, and the turn lands like any
    // normal one — one user message, one reply.
    await act(async () => {
      stream.push(
        sse('delta', { content: A2 }),
        sse('message', { content: A2, role: 'assistant' }),
        sse('done', { sessionId: 's-restore', tokens: 30, latencyMs: 800 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(qs('.pending-reply-row')).toBeNull();
    const after = loadChatState().sessions.find((s) => s.id === 's-restore');
    expect(after?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(after?.messages.filter((m) => m.content === U2)).toHaveLength(1);

    await unmountApp();
  });

  it('a conversation ending in an assistant reply restores without the row', async () => {
    dom.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        seedSession([userMsg('u1', U1), assistantMsg('a1', A1)], 's-complete'),
      ),
    );
    chatBodies.length = 0;
    await mountApp();

    expect(qs('.pending-reply-row')).toBeNull();
    expect(chatBodies).toHaveLength(0);

    await unmountApp();
  });
});

describe('P253 · restore affordance at the markup level', () => {
  const base = { loading: false, onSend: () => {}, onGenerateReply: () => {} };

  it('a trailing user message renders the quiet resend row', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, {
        ...base,
        messages: [userMsg('u1', U2)],
      }),
    );
    expect(markup).toContain('pending-reply-row');
    expect(markup).toContain('这次没等到回复');
    expect(markup).toContain('aria-label="重新发送"');
    expect(markup).toContain('重新发送');
    // The affordance is a quiet inline action, not a second primary CTA.
    expect(markup).not.toContain('class="welcome-cta"');
  });

  it('a trailing assistant message renders no resend row', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, {
        ...base,
        messages: [userMsg('u1', U1), assistantMsg('a1', A1)],
      }),
    );
    expect(markup).not.toContain('pending-reply-row');
    expect(markup).not.toContain('重新发送');
  });

  it('pendingReplyPrompt hands the resend the stored text verbatim', () => {
    const msgs = [userMsg('u1', U1), assistantMsg('a1', A1), userMsg('u2', U2)];
    expect(needsReply(msgs)).toBe(true);
    expect(pendingReplyPrompt(msgs)).toBe(U2);
    expect(needsReply([userMsg('u1', U1), assistantMsg('a1', A1)])).toBe(false);
  });
});
