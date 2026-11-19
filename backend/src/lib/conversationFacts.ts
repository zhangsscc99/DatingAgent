import type { Message } from '../agent/types.js';

/**
 * P313 — durable personal facts mined from the user's own messages. The
 * receipt on the client only ever surfaced 「看展」 because the fixed
 * keyword lexicon could not name 「三小时没回」 or 「带闺蜜」, and the
 * backend kept no memory at all. Facts are now extracted per turn from
 * the retained conversation history — lexicon hits plus a small set of
 * curated patterns — deduped and surfaced as `memory` on chat replies so
 * every distinct fact is admitted to be remembered. P323 adds a generic
 * clause fallback so a turn that matches nothing still contributes one
 * anchored fact — 「一直是我主动」「明天第一次约会」「要不要提前到」
 * all matched nothing before.
 *
 * Twin of frontend/src/lib/memoryReceipt.ts — keep the lexicon,
 * patterns and fallback rules in sync so the receipt and the API agree
 * on what counts.
 */

/** Curated keywords spanning interests / plans / feelings / work / dating. */
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
 * name. The matched span itself becomes the fact label (clipped short).
 * Keep it small and predictable; every pattern must name something worth
 * admitting to remember.
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
];

/**
 * P323 — generic fallback anchors: a clause becomes a fact when it names
 * a time cue, an agency cue, or a dating/plan cue. 「最近」 is deliberately
 * absent — as a generic sentence opener it admitted filler like
 * 「最近在聊一个同事」, which is precisely the kind of non-fact the
 * receipt must never name.
 */
const CONVERSATION_FACT_ANCHORS =
  /今天|明天|后天|昨天|周末|下周|第一次|刚才|一直|总是|是我|主动|要不要|该不该|怎么回|说什么|穿什么|约会|见面|约她|约他|告白|表白|聊天|回消息/;

/**
 * P323 — open deliberations stay out, the same boundary the curated
 * 「要不要(再|…)」 pattern documents: 「要不要约出来」「要不要一起去」
 * ask whether to act at all and are not facts; 「要不要提前到」 asks how
 * to act and stays admissible.
 */
const CONVERSATION_FACT_OPEN_DELIBERATION =
  /(?:要不要|该不该)(?:约|见|表白|告白|问|一起|聊)/;

/** P323 — boilerplate openers the receipt must never name. */
const CONVERSATION_FACT_FILLER: readonly string[] = [
  '你好',
  '在吗',
  '谢谢',
  '怎么办',
  '我该怎么办',
];

/**
 * P376 — a clause carrying a question word is the user's question, not a
 * fact about the user (「第一次约会安排在哪儿比较好」); the clause
 * fallback must never name it. Twin of memory-extract.ts QUESTION_MARK.
 * P387 widens it into the same hard rejection the extraction layer
 * applies: deliberation markers (行不行/要不要/该不该/是不是/能不能/
 * 可不可以) make the candidate a question, never a fact.
 */
const CONVERSATION_FACT_QUESTION =
  /哪儿|哪里|怎么|怎样|如何|为什么|为啥|什么|吗|呢|哪|行不行|要不要|该不该|是不是|能不能|可不可以/;

/** P387 — a candidate whose clause was uttered as a question is dropped. */
function clauseEndsAsQuestion(text: string, index: number): boolean {
  const boundary = /[，。！？；、,.!?;\n]/.exec(text.slice(index));
  return boundary !== null && (boundary[0] === '？' || boundary[0] === '?');
}

/** Clause boundaries for the P323 fallback split. */
const CONVERSATION_FACT_CLAUSE = /[^，。！？；、,.!?;\n]+/g;

/** How many facts a session admits it remembers. */
export const MEMORY_FACTS_MAX_ITEMS = 12;

/** One fact stays short enough for a single quiet line. */
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
 * Durable facts named in the user's own messages, in the order the user
 * first mentioned them, deduped, clipped short, capped at `maxItems`.
 * Assistant text never contributes. Candidates within one message are
 * sorted by position — longer span first on a tie — and a span
 * overlapping an already-accepted one is dropped, so 「三个小时没回我消息」
 * yields 「三个小时没回」 alone, never 「没回我消息」 on top.
 */
export function conversationFactItems(
  messages: readonly Pick<Message, 'role' | 'content'>[] | null | undefined,
  maxItems: number = MEMORY_FACTS_MAX_ITEMS,
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
      // P387 — a candidate that is itself a question, or whose clause was
      // uttered as one, is dropped completely; prefer missing over wrong.
      if (CONVERSATION_FACT_QUESTION.test(candidate.label)) continue;
      if (clauseEndsAsQuestion(text, candidate.index)) continue;
      if (accepted.some(([s, e]) => candidate.index < e && s < candidate.end)) {
        continue;
      }
      accepted.push([candidate.index, candidate.end]);
      seen.add(key);
      items.push(clip(candidate.label));
    }

    // P323 — a turn that admitted nothing still contributes one named
    // fact: the first clause carrying an anchor becomes the label. A
    // clause covering a matched-but-rejected span (e.g. a fact already
    // remembered in an earlier turn) defers to the lexicon/pattern
    // label. Bare questions with no anchor and boilerplate fillers fail
    // the anchor/stop-list checks on their own.
    if (accepted.length === 0) {
      for (const clause of text.matchAll(CONVERSATION_FACT_CLAUSE)) {
        if (items.length >= maxItems) break;
        const index = clause.index;
        if (index === undefined) continue;
        const label = clause[0].trim();
        const clipped = clip(label);
        if (clipped.length < 2 || clipped.length > VALUE_MAX_CHARS) continue;
        if (CONVERSATION_FACT_FILLER.includes(label.toLowerCase())) continue;
        if (CONVERSATION_FACT_OPEN_DELIBERATION.test(label)) continue;
        // P376 — a question clause is never a durable fact.
        if (CONVERSATION_FACT_QUESTION.test(label)) continue;
        if (clauseEndsAsQuestion(text, index)) continue;
        if (!CONVERSATION_FACT_ANCHORS.test(label)) continue;
        if (
          candidates.some((c) => index < c.end && c.index < index + clause[0].length)
        ) {
          continue;
        }
        const key = clipped.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(clipped);
        break;
      }
    }
  }
  return items;
}
