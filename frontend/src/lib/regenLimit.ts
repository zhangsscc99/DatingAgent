import type { ChatMessage } from '../types';

/**
 * P335 — 「换一个」 used to be a zero-cost infinite re-roll: same-weight
 * pill, no counter, no cooldown, so shaking again always dominated judging
 * the reply. A per-reply roll budget (REGEN_ROLL_LIMIT) now lives on the
 * message next to P332's versionIndex — in-memory only, serializeMessages
 * whitelists its fields so a refresh starts the budget fresh.
 *
 * Reaching the cap flips regenCooldownUntil to now + REGEN_COOLDOWN_MS;
 * the bubble renders the button disabled with the REGEN_LIMIT_HINT while
 * App owns a startRegenCooldown timeout that clears both fields when the
 * window elapses, restoring a fresh budget. The module stays DOM-free so
 * the limit/cooldown contract is testable under fake timers.
 */

/** 「换一个」 clicks a single assistant reply accepts before locking. */
export const REGEN_ROLL_LIMIT = 3;

/** Lock-out once the roll budget is spent; after it the counter resets. */
export const REGEN_COOLDOWN_MS = 20_000;

/** Visible copy shown next to the locked button. */
export const REGEN_LIMIT_HINT = `已达上限，${REGEN_COOLDOWN_MS / 1000} 秒后可再换`;

export interface RegenLimitState {
  /** Rolls consumed on this reply since the last reset (0..REGEN_ROLL_LIMIT). */
  rolls: number;
  /** Epoch millis when the lock lifts; null while the button is live. */
  cooldownUntil: number | null;
}

/** The message's roll budget as a plain state record. */
export function regenLimitStateOf(
  message: Pick<ChatMessage, 'regenRolls' | 'regenCooldownUntil'>,
): RegenLimitState {
  return {
    rolls: message.regenRolls ?? 0,
    cooldownUntil: message.regenCooldownUntil ?? null,
  };
}

/** Whether 换一个 accepts another roll at `now`. An elapsed cooldown is
 * treated as open even if the reset patch has not landed yet. */
export function regenAllowed(state: RegenLimitState, now: number): boolean {
  return state.cooldownUntil === null || now >= state.cooldownUntil;
}

/**
 * Record one consumed roll (called once per initiated regeneration — the
 * same patch point where P332 bumps versionIndex, so the two counters
 * cannot drift). The REGEN_ROLL_LIMIT-th roll starts the cooldown; a call
 * on a still-locked state is a no-op so a stray click can never spend
 * budget early. A roll taken after an elapsed-but-uncleared cooldown
 * restarts the budget from zero.
 */
export function noteRegenRoll(state: RegenLimitState, now: number): RegenLimitState {
  if (!regenAllowed(state, now)) return state;
  const rolls = (state.cooldownUntil === null ? state.rolls : 0) + 1;
  return {
    rolls,
    cooldownUntil: rolls >= REGEN_ROLL_LIMIT ? now + REGEN_COOLDOWN_MS : null,
  };
}

/**
 * Milliseconds left on the lock, or null when the button should be live.
 * The bubble reads this at render time; the App-owned cooldown timeout is
 * what re-renders it once the window has passed.
 */
export function regenCooldownRemainingMs(
  cooldownUntil: number | null | undefined,
  now: number,
): number | null {
  if (cooldownUntil == null) return null;
  const remaining = cooldownUntil - now;
  return remaining > 0 ? remaining : null;
}

export interface RegenCooldown {
  stop: () => void;
}

/**
 * Fire `onReset` once after `delayMs` — the App patches the message's roll
 * fields back to undefined so the button re-enables and the budget starts
 * fresh. Uses the ambient timeout functions so it runs identically in the
 * browser and under vitest fake timers; stop() is the unmount path and a
 * stopped cooldown must never fire.
 */
export function startRegenCooldown(
  delayMs: number,
  onReset: () => void,
): RegenCooldown {
  const id = setTimeout(onReset, delayMs);
  return {
    stop: () => {
      clearTimeout(id);
    },
  };
}
