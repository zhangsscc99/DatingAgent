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

const LABELS: Record<ReplyLengthPreference, string> = {
  default: '默认',
  concise: '精简',
  detailed: '详细',
};

/** Display label for a preference — shared by the composer toggle and tests. */
export function replyLengthLabel(pref: ReplyLengthPreference): string {
  return LABELS[pref];
}

/** P205: next preference in the 默认 → 精简 → 详细 → 默认 cycle. */
export function nextReplyLengthPreference(
  pref: ReplyLengthPreference,
): ReplyLengthPreference {
  const idx = VALID.indexOf(pref);
  return VALID[(idx + 1) % VALID.length];
}

/** P205: accessible name for the composer toggle — current 档位 + outcome. */
export function replyLengthToggleAriaLabel(pref: ReplyLengthPreference): string {
  return `回复长度：${replyLengthLabel(pref)}，点击切换为${replyLengthLabel(
    nextReplyLengthPreference(pref),
  )}`;
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
