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
 *
 * P313 — three turns each carrying a distinct fact still surfaced only
 * 「看展」: 「三小时没回」 and 「带闺蜜」 matched no lexicon keyword and
 * were silently dropped. Extraction now also runs a small set of curated
 * patterns whose matched span becomes the fact label, so one fact per
 * turn is admitted. Twin of backend/src/lib/conversationFacts.ts — keep
 * the lexicon and patterns in sync.
 *
 * P317 — the same walkthrough reproduced once more (Round 87, reagent
 * 「三小时没回消息 / 想问她在干嘛 / 周末看展」): the wait already matched,
 * but the user's stated intent — 「想问她在干嘛」「要不要再发一条」 —
 * still matched nothing. Two intent patterns now admit it too, so every
 * turn contributes a fact. Verbs are deliberately narrow: 「想约」
 * 「想带」 stay out so the lexicon/「带…」 hits keep their cleaner labels.
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

/**
 * P313 — curated patterns for concrete facts a fixed word list cannot
 * name. The matched span itself becomes the receipt label (clipped
 * short). Keep it small and predictable; every pattern must name
 * something worth admitting to remember.
 */
export const CONVERSATION_FACT_PATTERNS: readonly RegExp[] = [
  // 带闺蜜 / 带上猫 / 带着朋友 — who the user plans to bring along.
  /带[上着]?(?:闺蜜|朋友|兄弟|姐妹|哥们|家人|爸妈|父母|同事|同学|舍友|室友|对象|女朋友|男朋友|女友|男友|猫|狗)/g,
  // 三个小时没回 / 两天没理我 — a named wait.
  /(?:[0-9]+|[一二两三四五六七八九十半几]+)个?(?:分钟|小时|钟头|星期|个月|天|周|月|年)(?:没|不)(?:回|理|复|接|睬|应|找)/g,
  // 没回消息 / 不回我微信 — silence without a stated duration.
  /(?:没|不)回(?:我|她|他|ta)?(?:消息|微信|电话|信息)/g,
  // 想问她在干嘛 / 想请她吃饭 — an intent or wonder the user stated.
  // 「想约」「想带」 are excluded on purpose: the lexicon and the 「带…」
  // pattern above already name those facts with cleaner labels.
  /想(?:问|邀|请|见|送|表白|复合|确认|知道)[^，。！？!?；;：:、\s]{0,10}/g,
  // 要不要再发一条 / 要不要主动一点 — an open deliberation. Narrow
  // second char keeps 「要不要约出来」「要不要一起去」 out.
  /要不要(?:再|补|继续|主动|直接|先)[^，。！？!?；;：:、\s]{0,8}/g,
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

interface FactCandidate {
  /** Start offset in the scannable text. */
  index: number;
  /** End offset (exclusive) of the matched span. */
  end: number;
  /** Canonical lexicon entry or the matched text itself. */
  label: string;
}

/**
 * P296/P313 — durable facts named in the user's own messages, in the
 * order the user first mentioned them, deduped, clipped short, capped at
 * `maxItems`. Assistant text never contributes: the receipt must only
 * echo what the user actually said. Candidates within one message are
 * sorted by position — longer span first on a tie — and a span
 * overlapping an already-accepted one is dropped, so 「三个小时没回我消息」
 * yields 「三个小时没回」 alone, never 「没回我消息」 on top.
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
    const text = scannableText(message.content);
    if (text.trim().length < FACT_MIN_MESSAGE_CHARS) continue;
    const lower = text.toLowerCase();

    const candidates: FactCandidate[] = [];
    for (const keyword of CONVERSATION_FACT_LEXICON) {
      const index = lower.indexOf(keyword.toLowerCase());
      if (index !== -1) {
        candidates.push({ index, end: index + keyword.length, label: keyword });
      }
    }
    for (const pattern of CONVERSATION_FACT_PATTERNS) {
      for (const match of lower.matchAll(pattern)) {
        const index = match.index;
        if (index === undefined) continue;
        candidates.push({
          index,
          end: index + match[0].length,
          label: text.slice(index, index + match[0].length),
        });
      }
    }
    candidates.sort((a, b) => a.index - b.index || b.end - a.end);
    const accepted: Array<readonly [number, number]> = [];
    for (const candidate of candidates) {
      if (items.length >= maxItems) break;
      const key = candidate.label.toLowerCase();
      if (seen.has(key)) continue;
      if (
        accepted.some(([s, e]) => candidate.index < e && s < candidate.end)
      ) {
        continue;
      }
      accepted.push([candidate.index, candidate.end]);
      seen.add(key);
      items.push(clip(candidate.label));
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
