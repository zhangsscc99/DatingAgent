/**
 * P196 — 回复长度偏好 (reply-length preference).
 *
 * The choice persists in localStorage like the reply-language switch. Only a
 * non-default value ever travels to the backend: 默认 must send nothing extra
 * so an untouched install produces byte-identical chat requests.
 */

export type ReplyLengthPreference = 'default' | 'concise' | 'detailed';

/** Mirrors `ReplyLength` in backend/src/agent/types.ts — the request field. */
export type ReplyLengthRequest = 'concise' | 'detailed';

const VALID: readonly ReplyLengthPreference[] = ['default', 'concise', 'detailed'];

/**
 * P291 — the composer toggle speaks intent, not parameter names. The 档位
 * names below only appear in title/aria-label and the settings sheet.
 */
const INTENT_LABELS: Record<ReplyLengthPreference, string> = {
  default: '回答适中',
  concise: '回答简短一些',
  detailed: '回答详细一些',
};

const PARAM_LABELS: Record<ReplyLengthPreference, string> = {
  default: '默认',
  concise: '精简',
  detailed: '详细',
};

/** Visible label for a preference — shared by the composer toggle and tests. */
export function replyLengthLabel(pref: ReplyLengthPreference): string {
  return INTENT_LABELS[pref];
}

/** Internal 档位 name — title/aria-label and explicit settings only (P291). */
export function replyLengthParamLabel(pref: ReplyLengthPreference): string {
  return PARAM_LABELS[pref];
}

/** P205: next preference in the 默认 → 精简 → 详细 → 默认 cycle. */
export function nextReplyLengthPreference(
  pref: ReplyLengthPreference,
): ReplyLengthPreference {
  const idx = VALID.indexOf(pref);
  return VALID[(idx + 1) % VALID.length];
}

/**
 * P205/P291: accessible name for the composer toggle — describes the current
 * intent and the next one; the 档位 names are parenthesised technical detail.
 */
export function replyLengthToggleAriaLabel(pref: ReplyLengthPreference): string {
  const next = nextReplyLengthPreference(pref);
  return `回复长度：${replyLengthLabel(pref)}（${replyLengthParamLabel(
    pref,
  )}档），点击切换为${replyLengthLabel(next)}（${replyLengthParamLabel(next)}档）`;
}

export const REPLY_LENGTH_STORAGE_KEY = 'datingagent.replyLength';

export function readReplyLengthPreference(): ReplyLengthPreference {
  try {
    const stored = localStorage.getItem(REPLY_LENGTH_STORAGE_KEY);
    if (stored === 'default' || stored === 'concise' || stored === 'detailed') {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode) — the session keeps the default.
  }
  return 'default';
}

/** Persist the choice; best-effort, never throws. */
export function writeReplyLengthPreference(pref: ReplyLengthPreference): void {
  if (!VALID.includes(pref)) return;
  try {
    localStorage.setItem(REPLY_LENGTH_STORAGE_KEY, pref);
  } catch {
    // Storage unavailable — the in-memory choice still applies this session.
  }
}

/**
 * The `replyLength` field sent on /api/chat(/stream). 默认 maps to `undefined`
 * so the key is omitted from the serialized body entirely.
 */
export function replyLengthRequestField(
  pref: ReplyLengthPreference,
): ReplyLengthRequest | undefined {
  return pref === 'default' ? undefined : pref;
}
