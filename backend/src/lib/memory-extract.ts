import type { AgentContext, MemoryFact, Message } from '../agent/types.js';
import {
  CONVERSATION_FACT_LEXICON,
  CONVERSATION_FACT_PATTERNS,
} from './conversationFacts.js';

/**
 * P339 — durable memory written per user turn. The old receipt mined
 * facts on the fly with a keyword lexicon, so a turn that named a fact in
 * words the lexicon could not see (「她说最近有点累」) was silently
 * dropped while a sibling turn (「我明天第一次约会」) was kept — same
 * input class, different outcome. Extraction is now a stored per-turn
 * step with semantic-shaped patterns covering 人物+状态 / 我+时间+事件 /
 * 我想·打算·计划+X / 喜欢·讨厌·怕+X, plus the curated lexicon/pattern set
 * from conversationFacts.ts and the anchored-clause fallback. One message
 * can yield several facts; results are deduped by normalised text and
 * capped. Everything is a pure regex pass — no LLM, no clock, so the same
 * message always yields the same facts.
 *
 * Stored facts are {key, text, ts} objects; `key` is the normalised text
 * used for dedupe and for DELETE /api/conversations/:id/memory/:key.
 */

/** A fact pulled from one message, before it is stored (ts is added on write). */
export interface ExtractedFact {
  key: string;
  text: string;
}

/** Hard ceiling on remembered facts per session — keeps the store bounded. */
export const SESSION_MEMORY_MAX = 50;

/** One fact stays short enough for a single quiet capsule line. */
const FACT_MAX_CHARS = 20;

/** Clause boundaries: CJK and ASCII punctuation plus newlines. */
const CLAUSE_SPLIT = /[^，。！？；、,.!?;\n]+/g;

/**
 * Cues that make a subject clause a fact — a state (最近有点累 / 没回 /
 * 失眠), a time anchor (明天 / 周末 / 一直), or an explicit signal word.
 * Deliberately broad: an over-broad cue still names something the user
 * actually said, which is what memory is for.
 */
const FACT_CUE =
  /最近|今天|明天|昨天|今晚|周末|下周|现在|刚才|一直|总是|老是|又|经常|有点|有些|很|太|不太|不|没|别|想|要|累|忙|烦|开心|难过|焦虑|紧张|生气|冷淡|热情|失眠|生病|感冒|加班|出差|分手|回|睡|见面|约会|相亲|加班/;

/** Open deliberations are questions, not facts — same boundary as P323. */
const OPEN_DELIBERATION = /(?:要不要|该不该|是不是)(?:约|见|表白|告白|问|一起|聊|去)/;

/** Boilerplate openers that must never become a fact. */
const FACT_FILLER: readonly string[] = [
  '你好',
  '在吗',
  '谢谢',
  '怎么办',
  '我该怎么办',
];

/** Anchors for the clause fallback — kept in step with conversationFacts.ts. */
const CLAUSE_ANCHORS =
  /今天|明天|后天|昨天|周末|下周|第一次|刚才|一直|总是|是我|主动|要不要|该不该|怎么回|说什么|穿什么|约会|见面|约她|约他|告白|表白|聊天|回消息|最近|有点/;

interface Rule {
  re: RegExp;
  /** Display text built from the match (may differ from the span). */
  text: (m: RegExpMatchArray) => string;
  /** Extra gate on the match; false drops the candidate. */
  accept?: (m: RegExpMatchArray) => boolean;
}

/**
 * The semantic patterns. Order matters only on an index+span tie — a
 * stable sort keeps the earlier rule's cleaner label.
 */
const MEMORY_FACT_RULES: readonly Rule[] = [
  // 她说最近有点累 → 她最近有点累 — the speech verb is dropped.
  {
    re: /(她|他|ta|它)(?:说|讲|提到|坦白说)([^，。！？!?；;：:]{2,16})/g,
    text: (m) => `${m[1]}${m[2]}`,
    accept: (m) => FACT_CUE.test(m[2]),
  },
  // 她三天没回我 / 她回复有点慢 → subject + state, no speech verb.
  {
    re: /(她|他|ta|它)([^，。！？!?；;：:]{2,16})/g,
    text: (m) => `${m[1]}${m[2]}`,
    accept: (m) =>
      !/^(?:说|讲|提|告|跟|问|约|要|想|回我)/.test(m[2]) && FACT_CUE.test(m[2]),
  },
  // 我明天第一次约会 → 我+时间+(第N次)+事件.
  {
    re: /我(今天|明天|后天|昨天|昨晚|周末|下周|这周|今晚|明晚)(第[一二两三四五六七八九十0-9]+次)?([^，。！？!?；;：:]{2,12})/g,
    text: (m) => `我${m[1]}${m[2] ?? ''}${m[3]}`,
  },
  // 我想/打算/计划/准备/决定/希望 + X — a stated intent; an adverb
  // (还/也/本来…) may sit between subject and verb.
  {
    re: /我(还|也|真|正|本来|原本)?(想|打算|计划|准备|决定|希望)([^，。！？!?；;：:]{2,14})/g,
    text: (m) => `我${m[1] ?? ''}${m[2]}${m[3]}`,
  },
  // 我/她/我们 + 喜欢/不喜欢/讨厌/害怕/怕/爱 + X — a stated preference.
  {
    re: /(我|她|他|我们|ta)(最|很|特别|有点|还|真|好|也)?(喜欢|不喜欢|讨厌|害怕|怕|爱)([^，。！？!?；;：:]{1,12})/g,
    text: (m) => `${m[1]}${m[2] ?? ''}${m[3]}${m[4]}`,
  },
  // 明天第一次约会 / 周末相亲 — time + named event with no subject.
  {
    re: /(今天|明天|后天|昨天|昨晚|周末|下周|今晚|明晚)(第[一二两三四五六七八九十0-9]+次)?(约会|见面|相亲|表白|吃饭|看电影|看展|出差|面试|考试|旅行|散步|露营|爬山|游泳|健身)/g,
    text: (m) => `${m[1]}${m[2] ?? ''}${m[3]}`,
  },
];

interface Candidate {
  index: number;
  end: number;
  text: string;
}

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > FACT_MAX_CHARS
    ? `${trimmed.slice(0, FACT_MAX_CHARS)}…`
    : trimmed;
}

function factKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
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
 * The facts one user message carries, in the order they were stated,
 * deduped and span-overlap-resolved. Pure and deterministic — the same
 * message always produces the same list.
 */
export function extractMemoryFacts(message: string): ExtractedFact[] {
  const text = scannableText(message ?? '');
  if (text.trim().length < 2) return [];

  const candidates: Candidate[] = [];
  for (const rule of MEMORY_FACT_RULES) {
    for (const match of text.matchAll(rule.re)) {
      if (match.index === undefined) continue;
      if (rule.accept && !rule.accept(match)) continue;
      const label = clip(rule.text(match));
      if (factKey(label).length < 2) continue;
      candidates.push({ index: match.index, end: match.index + match[0].length, text: label });
    }
  }
  for (const pattern of CONVERSATION_FACT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      candidates.push({
        index: match.index,
        end: match.index + match[0].length,
        text: clip(match[0]),
      });
    }
  }
  const lower = text.toLowerCase();
  for (const keyword of CONVERSATION_FACT_LEXICON) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index !== -1) {
      candidates.push({ index, end: index + keyword.length, text: keyword });
    }
  }

  candidates.sort((a, b) => a.index - b.index || b.end - a.end);
  const items: ExtractedFact[] = [];
  const seen = new Set<string>();
  const accepted: Array<readonly [number, number]> = [];
  for (const candidate of candidates) {
    const key = factKey(candidate.text);
    if (seen.has(key)) continue;
    if (accepted.some(([s, e]) => candidate.index < e && s < candidate.end)) {
      continue;
    }
    accepted.push([candidate.index, candidate.end]);
    seen.add(key);
    items.push({ key, text: candidate.text });
  }

  // A turn that matched no pattern still contributes one fact: the first
  // anchored clause stands in, so an unclassifiable-but-real statement is
  // never dropped (「一直是我主动」「要不要提前到」).
  if (items.length === 0) {
    for (const clause of text.matchAll(CLAUSE_SPLIT)) {
      if (clause.index === undefined) continue;
      const label = clause[0].trim();
      const clipped = clip(label);
      const key = factKey(clipped);
      if (key.length < 2 || clipped.length > FACT_MAX_CHARS) continue;
      if (FACT_FILLER.includes(label.toLowerCase())) continue;
      if (OPEN_DELIBERATION.test(label)) continue;
      if (!CLAUSE_ANCHORS.test(label)) continue;
      seen.add(key);
      items.push({ key, text: clipped });
      break;
    }
  }

  return items;
}

/**
 * Whether `key` restates an already-kept fact — identical normalised
 * text, or one side containing the other when the shorter half is a real
 * phrase (>= 4 chars), so 「三个小时没回」 does not double up with
 * 「她三个小时没回消息了」 while 「累」 could never swallow a sentence.
 */
function sameFact(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}

/**
 * Fold one user message's facts into the session memory: forgotten keys
 * are never re-added, duplicates and near-duplicates merge, and the list
 * is capped at SESSION_MEMORY_MAX. Returns the live fact array.
 */
export function rememberUserMessage(
  context: AgentContext,
  message: string,
  ts: number = Date.now(),
): MemoryFact[] {
  const facts = (context.memoryFacts ??= []);
  const forgotten = (context.forgottenFactKeys ??= new Set<string>());
  for (const fact of extractMemoryFacts(message)) {
    if (forgotten.has(fact.key)) continue;
    if (facts.some((f) => sameFact(f.key, fact.key))) continue;
    if (facts.length >= SESSION_MEMORY_MAX) break;
    facts.push({ key: fact.key, text: fact.text, ts });
  }
  return facts;
}

/**
 * Re-run extraction over a history (used by /api/session/restore). Union
 * semantics: facts the session already kept stay, forgotten keys still
 * block re-adding — a deleted fact cannot resurrect through a restore.
 */
export function ingestSessionMemory(
  context: AgentContext,
  messages: readonly Pick<Message, 'role' | 'content'>[] = context.conversationHistory,
): MemoryFact[] {
  for (const message of messages) {
    if (message.role === 'user') rememberUserMessage(context, message.content);
  }
  return context.memoryFacts ?? [];
}

/**
 * Forget one fact by its key. The key joins the forgotten set so neither
 * a later identical statement nor a history restore re-adds it. Returns
 * false when the key is not remembered.
 */
export function forgetMemoryFact(context: AgentContext, key: string): boolean {
  const facts = context.memoryFacts ?? [];
  const index = facts.findIndex((f) => f.key === key);
  if (index === -1) return false;
  const [removed] = facts.splice(index, 1);
  (context.forgottenFactKeys ??= new Set<string>()).add(removed.key);
  return true;
}

/** The remembered facts in first-stated order. */
export function sessionMemoryFacts(context: AgentContext): MemoryFact[] {
  return context.memoryFacts ?? [];
}
