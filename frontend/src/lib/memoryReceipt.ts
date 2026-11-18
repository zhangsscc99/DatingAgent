import type { UserProfile } from '../types';
import { replyLengthLabel, type ReplyLengthPreference } from './replyLength';

/**
 * P293 — after a few turns nothing on screen acknowledged what the agent
 * had actually remembered. This derives a quiet one-line receipt from data
 * the client already holds: the stored profile (goals / interests /
 * personality) and the reply-length preference chosen this session. At
 * most two items are named; when nothing is remembered the line is null
 * and callers render nothing.
 */

export const MEMORY_RECEIPT_PREFIX = '已记住：';
export const MEMORY_RECEIPT_MAX_ITEMS = 2;

/** One receipt item must stay short enough for a single quiet line. */
const VALUE_MAX_CHARS = 20;

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > VALUE_MAX_CHARS
    ? `${trimmed.slice(0, VALUE_MAX_CHARS)}…`
    : trimmed;
}

/** Up to `MEMORY_RECEIPT_MAX_ITEMS` remembered preferences. */
export function rememberedItems(
  profile: UserProfile | null | undefined,
  replyLength: ReplyLengthPreference = 'default',
): string[] {
  const items: string[] = [];

  const goals = profile?.goals?.trim();
  if (goals) items.push(`目标「${clip(goals)}」`);

  const interests = (profile?.interests ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 2);
  if (interests.length > 0) items.push(`喜欢「${interests.join('、')}」`);

  const personality = profile?.personality?.trim();
  if (personality) items.push(`性格「${clip(personality)}」`);

  if (replyLength !== 'default') {
    items.push(`偏好${replyLengthLabel(replyLength)}`);
  }

  return items.slice(0, MEMORY_RECEIPT_MAX_ITEMS);
}

/**
 * The rendered receipt line, or null when nothing is remembered — callers
 * must render nothing in that case.
 */
export function memoryReceiptLine(
  profile: UserProfile | null | undefined,
  replyLength: ReplyLengthPreference = 'default',
): string | null {
  const items = rememberedItems(profile, replyLength);
  return items.length > 0 ? `${MEMORY_RECEIPT_PREFIX}${items.join('、')}` : null;
}
