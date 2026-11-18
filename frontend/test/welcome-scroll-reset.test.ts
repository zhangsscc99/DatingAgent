/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  type FakeDom,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P294 — on a clean first load the auto-scroll effect chased the bottomRef
 * sentinel, which sits below the margin:auto `.welcome` block, so the
 * `.messages` list landed scrolled to the bottom and clipped the top half of
 * the welcome heading. The scroll-to-tail now only runs once real content
 * exists (messages.length > 0 or a reply is in flight), leaving an empty
 * conversation pinned at scrollTop 0. Mounted against the repo fake DOM with
 * a spy on scrollIntoView — the same harness as
 * search-toggle-mobile-layout.test.ts.
 */

const noop = () => {};

describe('P294 · empty conversation keeps .messages scrolled to the top', () => {
  let dom: FakeDom;

  const qs = (sel: string) => dom.document.querySelector(sel) as FakeElement | null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  beforeAll(() => {
    dom = installFakeDom();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ tools: [] })),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('never calls scrollIntoView for an empty conversation and keeps scrollTop 0', async () => {
    const spy = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    const { createRoot } = await import('react-dom/client');
    const { default: ChatWindow } = await import('../src/components/ChatWindow');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(ChatWindow, {
          messages: [] as ChatMessage[],
          loading: false,
          onSend: noop,
        }),
      );
    });
    await flush();

    const list = qs('.messages');
    expect(list).not.toBeNull();
    // The welcome block is on screen…
    expect(qs('.welcome')).not.toBeNull();
    // …and nothing pulled the list to the bottom.
    expect(spy).not.toHaveBeenCalled();
    expect(list!.scrollTop).toBe(0);
    container.remove();
    spy.mockRestore();
  });

  it('still scrolls to the tail once a real message arrives', async () => {
    const spy = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    const { createRoot } = await import('react-dom/client');
    const { default: ChatWindow } = await import('../src/components/ChatWindow');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '她今天回得很慢', createdAt: 1 },
    ];
    await act(async () => {
      root.render(
        createElement(ChatWindow, { messages, loading: false, onSend: noop }),
      );
    });
    await flush();

    expect(spy).toHaveBeenCalled();
    container.remove();
    spy.mockRestore();
  });

  it('scrolls while a reply is in flight even before the bubble lands', async () => {
    const spy = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    const { createRoot } = await import('react-dom/client');
    const { default: ChatWindow } = await import('../src/components/ChatWindow');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(ChatWindow, {
          messages: [] as ChatMessage[],
          loading: true,
          onSend: noop,
        }),
      );
    });
    await flush();

    expect(spy).toHaveBeenCalled();
    container.remove();
    spy.mockRestore();
  });
});
