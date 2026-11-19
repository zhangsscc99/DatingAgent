/**
 * P349 — the in-conversation 「完善资料」 upsell used to render as a whole
 * card-like row (title line + chip + dismiss ×) directly above the composer,
 * which stole focus from the send key and, on desktop, appeared
 * unpredictably between turns. It is now a single compact capsule capped at
 * 32px, offered once after the first answer, and a dismissal is remembered
 * across reloads (spanning sessions) so it never nags twice.
 */

export const PROFILE_NUDGE_KEY = 'datingAgent.profileNudgeDismissed';

/** Hard visual contract from P349: the capsule never exceeds this height. */
export const PROFILE_NUDGE_MAX_HEIGHT_PX = 32;

/** Read the persisted dismissal flag. Never throws (private mode / quota). */
export function isProfileNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(PROFILE_NUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the dismissal so a reload does not bring the capsule back. */
export function dismissProfileNudge(): void {
  try {
    localStorage.setItem(PROFILE_NUDGE_KEY, '1');
  } catch {
    /* ignore — the in-memory state still hides it for this session */
  }
}

export interface ProfileNudgeInput {
  restoring: boolean;
  hasName: boolean;
  dismissed: boolean;
  /** Resident memory capsule / other bottom rows win (P308). */
  rowsVisible: number;
  onboardingDone: boolean;
  /** At least one completed assistant answer exists. */
  hasAnswer: boolean;
}

/** Pure display decision so the rule can be unit-tested without a DOM. */
export function shouldShowProfileNudge(input: ProfileNudgeInput): boolean {
  return (
    !input.restoring &&
    !input.hasName &&
    !input.dismissed &&
    input.rowsVisible === 0 &&
    !input.onboardingDone &&
    input.hasAnswer
  );
}
