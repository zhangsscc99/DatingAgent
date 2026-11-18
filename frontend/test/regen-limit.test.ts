/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import { serializeMessages } from '../src/lib/chatStorage';
import {
  REGEN_COOLDOWN_MS,
  REGEN_LIMIT_HINT,
  REGEN_ROLL_LIMIT,
  noteRegenRoll,
  regenAllowed,
  regenCooldownRemainingMs,
  regenLimitStateOf,
  startRegenCooldown,
  type RegenLimitState,
} from '../src/lib/regenLimit';
import type { ChatMessage } from '../src/types';

/**
 * P335 — 「换一个」 was a free infinite re-roll: same-weight pill, no count,
 * no cooldown, so mashing it dominated judging the reply. Each assistant
 * reply now gets REGEN_ROLL_LIMIT rolls counted on the message next to
 * P332's versionIndex; the cap stamps regenCooldownUntil, the bubble shows
 * a disabled 换一个 + 「已达上限」 hint, and an App-owned timeout clears the
 * lock after REGEN_COOLDOWN_MS. No DOM harness in this repo — the click
 * loop is exercised through the same reducer App patches with
 * (regenAllowed → noteRegenRoll), the rendered contract through
 * renderToStaticMarkup, the timer through fake timers, and the wiring
 * through source guards.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleSrc = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const appSrc = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const cssSrc = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

const NOW = 1_700_000_000_000;

const user = (content = '她回复很慢，我该怎么接？'): ChatMessage => ({
  id: 'u-1',
  role: 'user',
  content,
});

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: '顺着她提到的展览，把邀约说成共同计划。',
  createdAt: 2,
  ...over,
});

const render = (message: ChatMessage) =>
  renderToStaticMarkup(
    createElement(MessageBubble, {
      message,
      onRegenerate: () => {},
      onToggleReplyVersion: () => {},
    }),
  );

/** Slice of rendered markup covering just the 换一个 pill. */
const regenButtonBlock = (html: string) => {
  const at = html.indexOf('regen-btn');
  expect(at, 'regen button rendered').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</button>', at));
};

/** One 换一个 click, gated exactly like App's handleRegenerate: the roll is
 * spent only when regenAllowed passes, and the result is what gets patched
 * onto the message as regenRolls/regenCooldownUntil. */
const clickRegen = (state: RegenLimitState, now: number): RegenLimitState =>
  regenAllowed(state, now) ? noteRegenRoll(state, now) : state;

const messageWithLimit = (state: RegenLimitState, over: Partial<ChatMessage> = {}) =>
  assistant({
    regenRolls: state.rolls,
    regenCooldownUntil: state.cooldownUntil ?? undefined,
    ...over,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('P335 · 换一个 roll budget', () => {
  it('three clicks spend the budget and the fourth is blocked', () => {
    let state = regenLimitStateOf(assistant());
    state = clickRegen(state, NOW);
    expect(state).toEqual({ rolls: 1, cooldownUntil: null });
    state = clickRegen(state, NOW);
    expect(state).toEqual({ rolls: 2, cooldownUntil: null });
    state = clickRegen(state, NOW);
    expect(state.rolls).toBe(REGEN_ROLL_LIMIT);
    expect(state.cooldownUntil).toBe(NOW + REGEN_COOLDOWN_MS);
    // The 4th consecutive click hits the gate: no further roll is spent.
    expect(regenAllowed(state, NOW + 1)).toBe(false);
    expect(clickRegen(state, NOW + 1)).toEqual(state);
    expect(clickRegen(state, NOW + REGEN_COOLDOWN_MS - 1)).toEqual(state);
  });

  it('the capped bubble disables 换一个 with aria-disabled and a visible 「上限」 hint', () => {
    const capped = messageWithLimit(
      { rolls: REGEN_ROLL_LIMIT, cooldownUntil: Date.now() + REGEN_COOLDOWN_MS },
      { versionIndex: 4 },
    );
    const html = render(capped);
    const btn = regenButtonBlock(html);
    expect(btn).toContain('disabled=""');
    expect(btn).toContain('aria-disabled="true"');
    expect(html).toContain('regen-limit-hint');
    expect(html).toContain(REGEN_LIMIT_HINT);
    expect(html).toContain('上限');
  });

  it('cooldown expiry fires the reset once and the button is enabled again', () => {
    vi.useFakeTimers();
    const onReset = vi.fn();
    const cooldown = startRegenCooldown(REGEN_COOLDOWN_MS, onReset);
    vi.advanceTimersByTime(REGEN_COOLDOWN_MS - 1);
    expect(onReset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    // The reset patch clears both fields; a roll after an elapsed cooldown
    // restarts the budget from zero — another full 3-click window.
    const elapsed: RegenLimitState = { rolls: REGEN_ROLL_LIMIT, cooldownUntil: NOW };
    expect(regenAllowed(elapsed, NOW)).toBe(true);
    expect(noteRegenRoll(elapsed, NOW)).toEqual({ rolls: 1, cooldownUntil: null });
    const html = render(messageWithLimit({ rolls: 0, cooldownUntil: null }));
    const btn = regenButtonBlock(html);
    expect(btn).not.toContain('disabled=""');
    expect(btn).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('regen-limit-hint');
    cooldown.stop();
  });

  it('stop() (the unmount path) keeps a pending cooldown from ever firing', () => {
    vi.useFakeTimers();
    const onReset = vi.fn();
    startRegenCooldown(REGEN_COOLDOWN_MS, onReset).stop();
    vi.advanceTimersByTime(REGEN_COOLDOWN_MS * 2);
    expect(onReset).not.toHaveBeenCalled();
  });

  it("a different message's button is unaffected by the cap", () => {
    const other = render(assistant({ id: 'a-2' }));
    const btn = regenButtonBlock(other);
    expect(btn).not.toContain('disabled=""');
    expect(btn).not.toContain('aria-disabled="true"');
    expect(other).not.toContain('regen-limit-hint');
    expect(other).not.toContain('上限');
    // regenLimitStateOf is per message: an untouched bubble starts open.
    expect(regenLimitStateOf(assistant({ id: 'a-2' }))).toEqual({
      rolls: 0,
      cooldownUntil: null,
    });
  });

  it('P332 badge still matches the displayed version while capped', () => {
    // Three regens → versionIndex 4 (P332), regenRolls 3 (P335): separate
    // counters, so the badge is not double-counted by the new gate.
    const html = render(
      messageWithLimit(
        { rolls: REGEN_ROLL_LIMIT, cooldownUntil: Date.now() + REGEN_COOLDOWN_MS },
        { versionIndex: 4 },
      ),
    );
    expect(html).toContain('第 4 版');
    expect(html).toContain('aria-label="当前为第 4 版回复"');
    const state = noteRegenRoll(regenLimitStateOf(assistant()), NOW);
    expect(Object.keys(state).sort()).toEqual(['cooldownUntil', 'rolls']);
  });

  it('P276 keeps working: parked versions and the toggle render under the cap', () => {
    const html = render(
      assistant({
        regenRolls: REGEN_ROLL_LIMIT,
        regenCooldownUntil: Date.now() + REGEN_COOLDOWN_MS,
        previousVersion: { content: '旧版回复。' },
        versionIndex: 4,
      }),
    );
    expect(html).toContain('恢复上一版');
    expect(html).toContain('version-toggle');
  });

  it('the cap never reaches storage — serializeMessages drops both fields', () => {
    const [, out] = serializeMessages([
      user(),
      assistant({ regenRolls: 3, regenCooldownUntil: NOW + REGEN_COOLDOWN_MS }),
    ]);
    expect('regenRolls' in out).toBe(false);
    expect('regenCooldownUntil' in out).toBe(false);
  });

  it('an elapsed cooldown renders enabled even before the reset patch lands', () => {
    expect(regenCooldownRemainingMs(NOW - 1, NOW)).toBeNull();
    const html = render(assistant({ regenRolls: 3, regenCooldownUntil: Date.now() - 1 }));
    const btn = regenButtonBlock(html);
    expect(btn).not.toContain('disabled=""');
    expect(html).not.toContain('regen-limit-hint');
  });
});

describe('P335 · wiring guards', () => {
  it('App gates handleRegenerate on the cap and spends the roll on the same patch as versionIndex', () => {
    expect(appSrc).toContain('if (!regenAllowed(limit, now)) return;');
    expect(appSrc).toContain('const nextLimit = noteRegenRoll(limit, now);');
    const patchAt = appSrc.indexOf('versionIndex: (target.versionIndex ?? 1) + 1');
    expect(patchAt).toBeGreaterThan(-1);
    const patch = appSrc.slice(patchAt, appSrc.indexOf('});', patchAt));
    expect(patch).toContain('regenRolls: nextLimit.rolls');
    expect(patch).toContain('regenCooldownUntil: nextLimit.cooldownUntil ?? undefined');
  });

  it('App owns a per-message cooldown timeout, cleared on unmount', () => {
    expect(appSrc).toContain('startRegenCooldown(nextLimit.cooldownUntil - now');
    expect(appSrc).toContain('regenRolls: undefined');
    expect(appSrc).toContain('regenCooldownUntil: undefined');
    expect(appSrc).toContain('regenCooldownsRef.current.forEach((cooldown) => cooldown.stop())');
    expect(appSrc).toContain('regenCooldownsRef.current.clear()');
  });

  it('the bubble renders the cap from message fields — disabled, aria-disabled, hint', () => {
    expect(bubbleSrc).toContain('regenLimitStateOf(message).cooldownUntil');
    expect(bubbleSrc).toContain('regenCooldownRemainingMs(');
    expect(bubbleSrc).toContain('aria-disabled={regenCapped ? true : undefined}');
    expect(bubbleSrc).toContain('className="regen-limit-hint"');
    expect(bubbleSrc).toContain('regenLimitHint(regenCooldownLeftMs)');
  });

  it('the lock has a visible affordance and the hint reuses theme vars', () => {
    expect(cssSrc).toContain('.regen-btn[aria-disabled="true"]');
    expect(cssSrc).toContain('cursor: not-allowed');
    expect(cssSrc).toContain('.regen-limit-hint');
    expect(cssSrc).toContain('var(--text-secondary)');
  });
});
