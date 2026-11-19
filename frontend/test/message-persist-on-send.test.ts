/// <reference types="node" />
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  loadChatState,
  newSessionId,
  remapChatSessionId,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P253 — the just-sent user message used to exist only in React state until
 * the whole turn finished: a refresh inside the 3–24 s generation window
 * lost it entirely (chatHistory byte-identical before and after). The send
 * path now mints the session id up front and persists the user bubble the
 * moment it goes out, while the streaming placeholder is never written.
 *
 * Mount-level coverage runs against the fake DOM + a parked SSE stream —
 * the storage assertions land while the reply is still in flight, exactly
 * the window that used to lose the message.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const STORAGE_KEY = 'datingAgent.chatHistory';
const MSG = '测试刷新丢失：周六下午三点，看展还是喝咖啡，你定。';
const REPLY = '看展吧，走动的节奏更好聊天。';

interface StoredMessage {
  role: string;
  content: string;
}
interface StoredState {
  activeSessionId: string | null;
  sessions: Array<{ id: string; messages: StoredMessage[] }>;
}

describe('P253 · user message is persisted the moment it is sent', () => {
  let dom: FakeDom;
  let stream: ControlledSseStream;
  let chatBodies: Array<Record<string, unknown>>;
  let root: Root;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const stored = (): StoredState =>
    JSON.parse(dom.localStorage.getItem(STORAGE_KEY) ?? 'null') as StoredState;

  beforeAll(async () => {
    dom = installFakeDom();
    chatBodies = [];
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
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        return jsonResponse({});
      }),
    );
    // Skip the onboarding modal: the composer must be the first surface.
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

    // react-dom must evaluate AFTER the fake DOM exists (canUseDOM).
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
  });

  afterAll(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it('storage already holds the user message while the reply is still in flight', async () => {
    const ta = qs('textarea') as FakeElement;
    ta.value = MSG;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement;
    await act(async () => {
      send.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();

    // The SSE stream is parked — no delta, no done — yet the write landed.
    const raw = dom.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const state = stored();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(state.sessions[0].messages.map((m) => m.role)).toEqual(['user']);
    expect(state.sessions[0].messages[0].content).toBe(MSG);

    // Transient placeholder copy must never reach the persisted bytes —
    // a restore has to land on a settled state, not a frozen 「正在生成…」.
    for (const placeholder of ['正在生成', '正在思考', '正在整理', '已等待']) {
      expect(raw).not.toContain(placeholder);
    }

    // The request carried the same session id the message was stored under —
    // the client minted it and the backend adopts it (restore convention).
    expect(chatBodies).toHaveLength(1);
    expect(chatBodies[0].sessionId).toBe(state.sessions[0].id);
    expect(chatBodies[0].message).toBe(MSG);
  });

  it('the finished turn writes one user message plus the reply — no duplicate', async () => {
    const sessionId = stored().sessions[0].id;
    await act(async () => {
      stream.push(
        sse('delta', { content: REPLY }),
        sse('message', { content: REPLY, role: 'assistant' }),
        sse('done', { sessionId, tokens: 24, latencyMs: 900 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    const state = stored();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe(sessionId);
    expect(state.sessions[0].messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(
      state.sessions[0].messages.filter((m) => m.content === MSG),
    ).toHaveLength(1);
  });
});

describe('P253 · session id helpers', () => {
  beforeEach(() => {
    // The mounted-App block above wrote its own session into the shared
    // fake store — these assertions need a clean slate.
    localStorage.clear();
  });

  const userMsg = (content: string): ChatMessage => ({
    id: 'u1',
    role: 'user',
    content,
    createdAt: 1_000,
  });

  it('newSessionId returns unique non-empty ids', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('remapChatSessionId moves the stored entry and the active pointer', () => {
    saveChatSession('client-minted', [userMsg('保住这条')]);
    remapChatSessionId('client-minted', 'backend-uuid');

    const state = loadChatState();
    expect(state.activeSessionId).toBe('backend-uuid');
    expect(state.sessions.map((s) => s.id)).toEqual(['backend-uuid']);
    expect(state.sessions[0].messages[0].content).toBe('保住这条');
  });

  it('remap prefers the live conversation when the target id already exists', () => {
    saveChatSession('target', [userMsg('旧内容')]);
    saveChatSession('source', [userMsg('新内容')]);
    remapChatSessionId('source', 'target');

    const state = loadChatState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe('target');
    expect(state.sessions[0].messages[0].content).toBe('新内容');
  });

  it('remap is a no-op for matching or missing ids', () => {
    saveChatSession('keep', [userMsg('别动')]);
    const before = loadChatState();
    remapChatSessionId('keep', 'keep');
    remapChatSessionId('missing', 'other');
    expect(loadChatState()).toEqual(before);
  });
});

describe('P253 · send-path wiring (source guards)', () => {
  const app = read('App.tsx');

  it('runSend persists before the stream starts and forwards the minted id', () => {
    const runSend = app.slice(app.indexOf('const runSend'));
    const persistIdx = runSend.indexOf('saveChatSession(sid');
    const streamIdx = runSend.indexOf('await streamReply(prompt, assistantId, sid');
    expect(persistIdx).toBeGreaterThan(-1);
    expect(streamIdx).toBeGreaterThan(persistIdx);
    expect(runSend).toContain('sessionId ?? newSessionId()');
  });

  it('the streaming placeholder is excluded from the persisted list', () => {
    const runSend = app.slice(app.indexOf('const runSend'));
    const call = runSend.slice(
      runSend.indexOf('saveChatSession(sid'),
      runSend.indexOf('saveChatSession(sid') + 120,
    );
    expect(call).toContain('messagesRef.current');
    expect(call).toContain('userMessage');
    expect(call).not.toContain('assistantId');
  });

  it('the request body targets the persisted session id', () => {
    expect(app).toContain('sessionId: requestSessionId');
    expect(app).toContain('requestSessionId: string | null = sessionId');
    expect(app).toContain('remapChatSessionId(requestSessionId, d.sessionId)');
  });

  it('the backend adopts a client-issued session id', () => {
    const routes = read('../../backend/src/routes/app.ts');
    const resolver = routes.slice(routes.indexOf('function resolveChatSession'));
    expect(resolver).toContain('created.sessionId = sessionId');
  });
});
