import type { ChatMessage, UserProfile } from '../types';
import { replyLengthLabel, type ReplyLengthPreference } from './replyLength';

/**
 * P293 — after a few turns nothing on screen acknowledged what the agent
 * had actually remembered. This derives a quiet one-line receipt from data
 * the client already holds: the stored profile (goals / interests /
 * personality) and the reply-length preference chosen this session. At
 * most two items are named; when nothing is remembered the line is null
 * and callers render nothing.
 *
 * P296 — the profile-less path (the default: the profile dialog no longer
 * auto-opens) stayed silent forever, so three real turns still showed no
 * receipt. `conversationFactItems` now mines durable life facts straight
 * from the user's own messages via a small curated lexicon — no LLM, no
 * network, deterministic.
 */

export const MEMORY_RECEIPT_PREFIX = '记得你提到：';
export const MEMORY_RECEIPT_MAX_ITEMS = 2;

/**
 * P296 — curated keywords spanning interests / plans / feelings / work /
 * sleep / dating. Plain substring match, case-insensitive; keep it small
 * and predictable — every entry is a fact worth admitting to remember.
 */
export const CONVERSATION_FACT_LEXICON: readonly string[] = [
  '看展',
  '展览',
  '爬山',
  '徒步',
  '健身',
  '跑步',
  '摄影',
  '做饭',
  '游泳',
  '骑行',
  '旅行',
  '加班',
  '出差',
  '面试',
  '考试',
  '熬夜',
  '没睡好',
  '失眠',
  '焦虑',
  '紧张',
  '压力大',
  '相亲',
  '表白',
  '异地',
  '暗恋',
  '心动',
  '分手',
  '复合',
  '催婚',
];

/** One receipt item must stay short enough for a single quiet line. */
const VALUE_MAX_CHARS = 20;

/** Messages shorter than this carry no durable fact worth naming. */
const FACT_MIN_MESSAGE_CHARS = 2;

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > VALUE_MAX_CHARS
    ? `${trimmed.slice(0, VALUE_MAX_CHARS)}…`
    : trimmed;
}

/** Strip fenced code blocks and URLs so a keyword inside noise never counts. */
function scannableText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*$/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ');
}

/**
 * P296 — durable facts named in the user's own messages, in the order the
 * user first mentioned them, deduped, clipped short, capped at `maxItems`.
 * Assistant text never contributes: the receipt must only echo what the
 * user actually said.
 */
export function conversationFactItems(
  messages:
    | readonly Pick<ChatMessage, 'role' | 'content'>[]
    | null
    | undefined,
  maxItems: number = MEMORY_RECEIPT_MAX_ITEMS,
): string[] {
  const items: string[] = [];
  if (!messages || maxItems <= 0) return items;
  const seen = new Set<string>();
  for (const message of messages) {
    if (items.length >= maxItems) break;
    if (message.role !== 'user') continue;
    const text = scannableText(message.content).trim().toLowerCase();
    if (text.length < FACT_MIN_MESSAGE_CHARS) continue;
    for (const keyword of CONVERSATION_FACT_LEXICON) {
      if (items.length >= maxItems) break;
      const key = keyword.toLowerCase();
      if (seen.has(key) || !text.includes(key)) continue;
      seen.add(key);
      items.push(clip(keyword));
    }
  }
  return items;
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
 * The remembered items behind the receipt, as a list — P308 renders each
 * entry as a deletable row, so callers need the items un-joined. Same
 * derivation and cap as `memoryReceiptLine`; an empty list means render
 * nothing.
 */
export function memoryReceiptItems(
  profile: UserProfile | null | undefined,
  replyLength: ReplyLengthPreference = 'default',
  messages?: readonly Pick<ChatMessage, 'role' | 'content'>[],
): string[] {
  const items = rememberedItems(profile, replyLength);
  if (messages === undefined) return items;
  if (!messages.some((m) => m.role === 'user')) return [];
  for (const fact of conversationFactItems(messages)) {
    if (items.length >= MEMORY_RECEIPT_MAX_ITEMS) break;
    if (items.some((item) => item.includes(fact))) continue;
    items.push(fact);
  }
  return items;
}

/**
 * The rendered receipt line, or null when nothing is remembered — callers
 * must render nothing in that case. P308 changed the prefix to
 * 「记得你提到：」 alongside the capsule treatment.
 *
 * P296 — `messages` is optional: the two-argument call keeps the exact
 * P293 behaviour. When a conversation is passed, profile-derived items
 * come first and user-message facts fill the remaining slots (deduped —
 * a fact already named inside a profile item is not repeated), and a
 * conversation with no user message at all yields null so an empty chat
 * never shows the line.
 */
export function memoryReceiptLine(
  profile: UserProfile | null | undefined,
  replyLength: ReplyLengthPreference = 'default',
  messages?: readonly Pick<ChatMessage, 'role' | 'content'>[],
): string | null {
  const items = memoryReceiptItems(profile, replyLength, messages);
  return items.length > 0 ? `${MEMORY_RECEIPT_PREFIX}${items.join('、')}` : null;
}
