/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { installFakeDom, type FakeDom } from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import {
  COARSE_POINTER_QUERY,
  HERO_HINT_KEYBOARD,
  HERO_HINT_TOUCH,
} from '../src/lib/heroHint';

/**
 * P362 — device-level regression for the first-screen send hint.
 *
 * Measured fact behind this test: the live build at 2026-11-19 10:16 UTC,
 * re-measured at 390×844 with touch emulation, reported
 * `matchMedia('(pointer: coarse)').matches === true` and rendered
 * `.welcome-hint` = 「在下方输入框写下你的情况，点发送即可开始。」 — i.e. the
 * P362 walkthrough finding (「回车发送」 on a phone) was a stale-build report.
 * The copy logic itself was already correct; the real gap it exposed is that
 * `hero-copy.test.ts` only exercises the pure function and the no-window SSR
 * path (both resolve to the keyboard copy), so a future regression that
 * pinned the keyboard string into the touch render would go unnoticed.
 *
 * P374 — the compact screen's auxiliary-copy budget is two muted lines, so
 * `.welcome-hint` no longer mounts at ≤768px at all (the hero's primary
 * button does the pointing there). The device copy still decides the
 * rendered string everywhere the line does mount — this file mounts the
 * real ChatWindow in the fake-DOM harness under a coarse-pointer
 * environment and a fine-pointer desktop environment and asserts the
 * rendered `.welcome-hint` text against the shared `lib/heroHint.ts`
 * constants — a hard-coded literal in the component fails — plus the
 * narrow-viewport non-render.
 */

const noop = () => {};

interface MountedCase {
  dom: FakeDom;
  root: Root;
  hintText: () => string | null;
}

/**
 * Mount ChatWindow against a fresh fake DOM whose matchMedia reports
 * `coarse` for '(pointer: coarse)' and `narrow` for '(max-width: 768px)'.
 * react-dom is imported lazily per case because its canUseDOM flag is
 * captured at module evaluation time.
 */
async function mountChatWindow(
  coarse: boolean,
  narrow: boolean,
): Promise<MountedCase> {
  const dom = installFakeDom();
  const mq = (query: string) => ({
    matches:
      query === COARSE_POINTER_QUERY
        ? coarse
        : query === '(max-width: 768px)'
          ? narrow
          : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  (dom.window as Record<string, unknown>).matchMedia = mq;
  vi.stubGlobal('matchMedia', mq);

  const { createRoot } = await import('react-dom/client');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      createElement(ChatWindow, {
        messages: [],
        loading: false,
        onSend: noop,
      }),
    );
    // Flush the useMediaQuery effect passes (setMatches inside useEffect).
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });

  return {
    dom,
    root,
    hintText: () =>
      dom.document.querySelector('.welcome-hint')?.textContent ?? null,
  };
}

describe('P362 · mounted hero hint matches the device', () => {
  let mounted: MountedCase | null = null;

  afterEach(async () => {
    if (mounted) {
      const root = mounted.root;
      mounted = null;
      await act(async () => {
        root.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it('coarse pointer renders the touch copy — no 回车, names 发送', async () => {
    // A coarse pointer on a ≥769px viewport (tablet/landscape) still shows
    // the hint line — and it must be the touch copy, never the keyboard
    // one pinned in by hand.
    mounted = await mountChatWindow(true, false);
    const text = mounted.hintText();
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/回车/);
    expect(text).toContain('发送');
    // The rendered string must be the shared constant, so a literal like
    // 「…点右下角发送即可开始」 typed into the component fails here.
    expect(text).toBe(HERO_HINT_TOUCH);
  });

  it('the compact screen mounts no hint line at all (P374)', async () => {
    // 390×844 coarse pointer: the auxiliary-copy budget is two muted
    // lines, so the device hint is dropped there — the hero's primary
    // button does the pointing instead.
    mounted = await mountChatWindow(true, true);
    expect(mounted.hintText()).toBeNull();
  });

  it('fine-pointer desktop renders the keyboard copy unchanged', async () => {
    mounted = await mountChatWindow(false, false);
    const text = mounted.hintText();
    expect(text).not.toBeNull();
    expect(text).toContain('回车发送');
    expect(text).toBe(HERO_HINT_KEYBOARD);
  });
});
