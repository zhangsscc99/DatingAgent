/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
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
  PROFILE_NUDGE_KEY,
  PROFILE_NUDGE_MAX_HEIGHT_PX,
  dismissProfileNudge,
  isProfileNudgeDismissed,
  shouldShowProfileNudge,
} from '../src/lib/profileNudge';

/**
 * P349 — the 「想让我更懂你的处境？完善资料 ×」 upsell used to render as a
 * whole card directly above the composer (measured 1440×900: it sat flush
 * against the input bar and pulled the eye away from the send key), and it
 * only appeared under some first-turn conditions while staying up for the
 * rest of the session. The contract now:
 *   - one capsule, never taller than 32px, above the composer;
 *   - no second clickable 「完善资料」 control inside the chat area;
 *   - a dismissal is persisted, so it never comes back after a reload;
 *   - the rule still holds after several turns.
 * Layout is locked by asserting the CSS contract + DOM shape (this repo has
 * no Playwright in the vitest suite; the live 390×844 / 1440×900 pixel
 * measurement is done by the loop dispatcher).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(join(SRC, 'components', 'ChatWindow.css'), 'utf8');

const CSS_SCOPE = '.profile-nudge';

/** `.profile-nudge { … }` base rule body (not the -btn / -dismiss variants,
 *  and not the narrow-screen override that only re-pins the height). */
function baseCapsuleRule(css: string): string {
  const re = /\.profile-nudge\s*\{([^}]*)\}/g;
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  const base = bodies.find((b) => b.includes('border-radius'));
  expect(base, 'expected the `.profile-nudge` base rule with the pill shape').toBeTruthy();
  return base!;
}

describe('P349 · the profile upsell is one <=32px capsule, dismissed for good', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  let streams: ControlledSseStream[];

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const click = (el: FakeElement) =>
    el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));

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

  const sendAndAnswer = async (text: string, reply: string) => {
    const ta = qs('#chat-input') as FakeElement;
    ta.value = text;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement;
    await act(async () => {
      click(send);
    });
    await flush();
    const stream = streams.at(-1)!;
    await act(async () => {
      stream.push(
        sse('delta', { content: reply }),
        sse('message', { content: reply, role: 'assistant' }),
        sse('done', { sessionId: 's-live', tokens: 20, latencyMs: 700 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  /** Clickables mentioning 完善资料 inside one subtree (the chat column —
   *  the sidebar / welcome CTA keep their own, legitimate entries). */
  const probeUpsellControls = (scope: FakeElement) =>
    scope.querySelectorAll('button, a').filter((el) =>
      el.textContent.includes('完善资料'),
    );

  beforeAll(() => {
    dom = installFakeDom();
    streams = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/chat/stream') {
          const stream = new ControlledSseStream();
          streams.push(stream);
          return sseResponse(stream);
        }
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        if (url === '/api/session/restore') {
          return jsonResponse({ sessionId: 's-seed', restored: true });
        }
        return jsonResponse({});
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the decision is pure: no answer, a saved profile or a dismissal keeps it down', () => {
    const base = {
      restoring: false,
      hasName: false,
      dismissed: false,
      rowsVisible: 0,
      onboardingDone: false,
      hasAnswer: true,
    };
    expect(shouldShowProfileNudge(base)).toBe(true);
    expect(shouldShowProfileNudge({ ...base, hasAnswer: false })).toBe(false);
    expect(shouldShowProfileNudge({ ...base, hasName: true })).toBe(false);
    expect(shouldShowProfileNudge({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowProfileNudge({ ...base, rowsVisible: 1 })).toBe(false);
    expect(shouldShowProfileNudge({ ...base, onboardingDone: true })).toBe(false);
    expect(shouldShowProfileNudge({ ...base, restoring: true })).toBe(false);
  });

  it('the base CSS rule pins the capsule to <=32px, one line high', () => {
    const rule = baseCapsuleRule(chatWindowCss);
    const maxHeight = rule.match(/max-height:\s*(\d+)px/);
    expect(maxHeight, 'max-height is the P349 ceiling').toBeTruthy();
    expect(Number(maxHeight![1])).toBeLessThanOrEqual(PROFILE_NUDGE_MAX_HEIGHT_PX);
    const height = rule.match(/height:\s*(\d+)px/);
    expect(height).toBeTruthy();
    expect(Number(height![1])).toBeLessThanOrEqual(PROFILE_NUDGE_MAX_HEIGHT_PX);
    // no stacked card: it is an inline pill, not a flex row block
    expect(rule).toContain('inline-flex');
    expect(rule).toContain('border-radius');
  });

  it('after the first answer exactly one capsule shows, with no competing 完善资料 control', async () => {
    dom.localStorage.clear();
    await mountApp();
    expect(qs('.profile-nudge')).toBeNull();

    await sendAndAnswer('她今天主动约我周末看展', '那就答应，顺手定个时间。');

    const capsules = qsa('.profile-nudge');
    expect(capsules).toHaveLength(1);
    const capsule = capsules[0] as FakeElement;
    expect(capsule.getAttribute('data-nudge')).toBe('capsule');
    expect(capsule.textContent).toContain('完善资料');
    // Everything clickable that says 完善资料 lives inside that capsule —
    // no second chip/card competing with the composer.
    const controls = probeUpsellControls(capsule.parentElement as FakeElement);
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.closest(CSS_SCOPE)).toBeTruthy();
    }
    // …and it sits immediately above the composer, as a sibling line.
    const composerBar = (qs('#chat-input') as FakeElement).closest('.input-bar')!;
    expect(composerBar).toBeTruthy();
    const parent = capsule.parentNode!;
    const nudgeIdx = parent.childNodes.indexOf(capsule);
    const barIdx = parent.childNodes.indexOf(composerBar);
    expect(nudgeIdx).toBeGreaterThan(-1);
    expect(barIdx).toBeGreaterThan(nudgeIdx);

    await unmountApp();
  });

  it('still one capsule after three turns — it never turns into a card again', async () => {
    dom.localStorage.clear();
    await mountApp();
    await sendAndAnswer('第一句', '先别急。');
    await sendAndAnswer('第二句', '可以再等等。');
    await sendAndAnswer('第三句', '那就约。');

    expect(qsa('.profile-nudge')).toHaveLength(1);
    expect(qsa('.profile-nudge .profile-nudge-btn').length).toBeLessThanOrEqual(2);
    const capsule = qs('.profile-nudge') as FakeElement;
    for (const control of probeUpsellControls(capsule.parentElement as FakeElement)) {
      expect(control.closest(CSS_SCOPE)).toBeTruthy();
    }

    await unmountApp();
  });

  it('dismissing persists across a reload', async () => {
    dom.localStorage.clear();
    await mountApp();
    await sendAndAnswer('她没回我', '给她一点时间。');

    const dismiss = qs('.profile-nudge-dismiss') as FakeElement;
    expect(dismiss).toBeTruthy();
    await act(async () => {
      click(dismiss);
    });
    await flush();

    expect(qs('.profile-nudge')).toBeNull();
    expect(dom.localStorage.getItem(PROFILE_NUDGE_KEY)).toBe('1');
    expect(isProfileNudgeDismissed()).toBe(true);

    // Reload: same storage, fresh tree — the capsule must not return.
    await unmountApp();
    await mountApp();
    expect(qs('.profile-nudge')).toBeNull();

    await unmountApp();
  });

  it('the persisted helpers never throw when storage is unavailable', () => {
    const original = dom.localStorage.setItem;
    dom.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => dismissProfileNudge()).not.toThrow();
    dom.localStorage.setItem = original;
  });
});
