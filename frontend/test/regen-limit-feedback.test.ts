/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { installFakeDom, type FakeDom, type FakeElement } from './helpers/fakeDom';
import {
  REGEN_COOLDOWN_MS,
  REGEN_ROLL_LIMIT,
  noteRegenRoll,
  regenAllowed,
  regenLimitHint,
  regenLimitStateOf,
} from '../src/lib/regenLimit';
import type { ChatMessage } from '../src/types';

/**
 * P338 — live observation (390×844): after the roll budget was spent the
 * 换一个 button vanished from the DOM entirely (querySelectorAll n=0) and
 * no 「已达上限」 copy rendered anywhere — the user could not tell "hit the
 * cap" from "the feature broke". Root cause: the cap was rendered through
 * `canRegen`, which flips off the moment the capped regeneration flags the
 * bubble streaming/regenerating — so the button unmounted exactly when the
 * budget ran out, and stayed gone if that regen errored.
 *
 * Contract asserted here on the mounted fake DOM:
 *  (a) a spent budget keeps .regen-btn mounted, disabled + aria-disabled —
 *     INCLUDING while the capped regen is still in flight;
 *  (b) a visible .regen-limit-hint matches /已达上限，N 秒后可再换/ with a
 *     plausible remaining-seconds count that ticks down live;
 *  (c) once the cooldown elapses (fake timers) the button re-enables and
 *     the hint disappears — no refresh, no re-send;
 *  (d) exactly REGEN_ROLL_LIMIT rolls pass the App's regenAllowed gate.
 */

const NOW = Date.now();

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: '顺着她提到的展览，把邀约说成共同计划。',
  createdAt: NOW,
  ...over,
});

const mount = async (dom: FakeDom, message: ChatMessage) => {
  const { createRoot } = await import('react-dom/client');
  const { default: MessageBubble } = await import('../src/components/MessageBubble');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      createElement(MessageBubble, { message, onRegenerate: () => {} }),
    );
    await Promise.resolve();
  });
  return container;
};

const regenBtn = (el: FakeElement) => el.querySelector('.regen-btn');
const hint = (el: FakeElement) => el.querySelector('.regen-limit-hint');
const hintSeconds = (el: FakeElement): number => {
  const m = /已达上限，(\d+) 秒后可再换/.exec(hint(el)?.textContent ?? '');
  expect(m, 'hint shows remaining seconds').not.toBeNull();
  return Number(m![1]);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('P338 · the cap keeps the button on screen with a live countdown', () => {
  it('(a) the spent budget leaves .regen-btn mounted, disabled and aria-disabled', async () => {
    const dom = installFakeDom();
    const capped = assistant({
      regenRolls: REGEN_ROLL_LIMIT,
      regenCooldownUntil: Date.now() + REGEN_COOLDOWN_MS,
    });
    const el = await mount(dom, capped);
    const btn = regenBtn(el);
    expect(btn, '换一个 button must stay in the DOM').not.toBeNull();
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute('aria-disabled')).toBe('true');
    expect(hint(el), 'regen-limit-hint rendered').not.toBeNull();
  });

  it('(a) the button also stays while the capped regen is still in flight', async () => {
    // This is the exact vacuum the walkthrough hit: the cap lands on the
    // same patch that sets streaming+regenerating, so gating on canRegen
    // unmounted the button for the whole lock's opening window.
    const dom = installFakeDom();
    const el = await mount(
      dom,
      assistant({
        streaming: true,
        regenerating: true,
        regenRolls: REGEN_ROLL_LIMIT,
        regenCooldownUntil: Date.now() + REGEN_COOLDOWN_MS,
      }),
    );
    const btn = regenBtn(el);
    expect(btn, 'in-flight capped regen keeps the button mounted').not.toBeNull();
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute('aria-disabled')).toBe('true');
    expect(hint(el)!.textContent).toMatch(/已达上限，\d+ 秒后可再换/);
  });

  it('(b) the hint matches /已达上限，N 秒后可再换/ with a plausible count', async () => {
    const dom = installFakeDom();
    const el = await mount(
      dom,
      assistant({
        regenRolls: REGEN_ROLL_LIMIT,
        regenCooldownUntil: Date.now() + REGEN_COOLDOWN_MS,
      }),
    );
    const seconds = hintSeconds(el);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(REGEN_COOLDOWN_MS / 1000);
  });

  it('(b/c) the countdown ticks live and the button re-enables on its own once the lock lifts', async () => {
    vi.useFakeTimers();
    const dom = installFakeDom();
    const el = await mount(
      dom,
      assistant({
        regenRolls: REGEN_ROLL_LIMIT,
        regenCooldownUntil: Date.now() + 3_000,
      }),
    );
    expect(hintSeconds(el)).toBe(3);
    // The 1s tick re-derives the remaining seconds without any re-send.
    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
    });
    expect(hintSeconds(el)).toBe(2);
    expect(regenBtn(el)!.disabled).toBe(true);
    // Cooldown elapsed → the tick flips the bubble live again: enabled
    // button, no hint, no refresh or field patch required.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    const btn = regenBtn(el);
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.getAttribute('aria-disabled')).toBeNull();
    expect(hint(el)).toBeNull();
  });

  it('(d) exactly REGEN_ROLL_LIMIT rolls pass the gate, the next is refused', () => {
    // Same gate App's handleRegenerate runs before it ever touches
    // streamReply — a refused roll can never spend a request.
    let state = regenLimitStateOf(assistant());
    let spent = 0;
    const now = Date.now();
    while (regenAllowed(state, now)) {
      state = noteRegenRoll(state, now);
      spent += 1;
    }
    expect(spent).toBe(REGEN_ROLL_LIMIT);
    expect(state.rolls).toBe(REGEN_ROLL_LIMIT);
    expect(state.cooldownUntil).toBe(now + REGEN_COOLDOWN_MS);
  });

  it('regenLimitHint derives 「已达上限，N 秒后可再换」 from live remaining ms', () => {
    expect(regenLimitHint(REGEN_COOLDOWN_MS)).toBe('已达上限，20 秒后可再换');
    expect(regenLimitHint(17_400)).toBe('已达上限，18 秒后可再换');
    expect(regenLimitHint(400)).toBe('已达上限，1 秒后可再换');
  });
});
