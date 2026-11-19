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

/** A fact shorter than this cannot carry a subject + action/state. */
const FACT_MIN_CHARS = 6;

/**
 * P392 — a stored fact needs a predicate, not just a noun phrase: the
 * Round-106 capsule listed 「我明天第一次约会」, a headline clipped out
 * of the question 「明天第一次约会，穿卫衣去会不会太随便？」 — subject
 * present, no verb, unreadable as a statement. Below 8 chars a
 * candidate must carry a verb/state word to be kept; longer texts
 * already passed a recognisable-event pattern.
 */
const FACT_PREDICATE_MIN_CHARS = 8;
const FACT_PREDICATE =
  /[是有在没想回理接找约见聊问说讲去来吃喝看穿带送睡醒忙累烦困病等到走做干买给帮发打写读听唱跳跑游爬练学考分合爱怕哭笑忘记定住谈试懂加追催婚恋班差动心事上下]/;

/**
 * P382 — a stored fact leads with its subject: the 「主语 + 状态/动作」
 * shape is what separates a remembered fact from a restated fragment.
 * 「对方」 covers clauses written about the match without a pronoun.
 */
const FACT_LEADING_SUBJECT = /^(她|他|我|我们|对方)/;

/**
 * P382 — these endings mark the text as the user's question, not a
 * statement about them (「…怎么办」「…在哪儿」「…有空吗」); nothing
 * shaped like that may be stored.
 */
const FACT_QUESTION_END = /(?:吗|呢|哪儿|哪里|怎么|怎样|如何|为什么|为啥)$/;

/**
 * P366 — every stored fact must read as a standalone sentence: an
 * explicit subject plus an action/state. The Round-97 walkthrough
 * caught 「她先不回我的」 — a clause clipped on a dangling 的 — and
 * 「就是烦」 — no subject, three chars — sitting in the sidebar and
 * capsule where a reader could not tell what was remembered. P382
 * tightens the subject gate to a LEADING subject: a headline clause
 * like 「明天第一次约会」 is rewritten as 「我明天第一次约会」 before
 * it reaches the store, so no fragment leads the fact. A candidate
 * that fails here is dropped, never stored.
 */
function isStandaloneFact(text: string): boolean {
  const t = text.trim();
  if (t.length < FACT_MIN_CHARS) return false;
  // A clause ending in 的/地/得 is a clipped fragment, not a fact.
  if (/[的地得]$/.test(t)) return false;
  // A question ending is the user's question restated, not a fact.
  if (FACT_QUESTION_END.test(t)) return false;
  // P392 — a short candidate with no verb/state word is a headline
  // fragment (「明天的安排」), not a fact. Subject + predicate required.
  if (t.length < FACT_PREDICATE_MIN_CHARS && !FACT_PREDICATE.test(t)) return false;
  return FACT_LEADING_SUBJECT.test(t);
}

/**
 * P376 — a memory fact is a statement about the user, never the user's
 * own question restated. The Round-103 capsule listed 「第一次约会安
 * 排在哪儿比较好」 verbatim: an anchored clause that passed every gate
 * yet asks a question — and, minus the punctuation, is the session
 * title itself. Any candidate carrying a question word is rewritten to
 * its declarative core (the span before the marker with the leading-in
 * words trimmed); when nothing readable survives it is dropped, never
 * stored.
 */
const QUESTION_MARK = /哪儿|哪里|怎么|怎样|如何|为什么|为啥|什么|吗|呢|哪/;

/** Words that only lead into the question — trimming them leaves the declarative core. */
const QUESTION_LEAD_IN = /[的地得在了要该想会愿意望打算安排办问说讲]+$/u;

/**
 * The statement inside a candidate, or null when the candidate is only a
 * question. 「我明天第一次约会在哪办好」 → 「我明天第一次约会」;
 * 「第一次约会安排在哪儿比较好」 leaves only a dangling fragment.
 */
function declarativeCore(text: string): string | null {
  const mark = QUESTION_MARK.exec(text);
  if (!mark) return text;
  const core = text.slice(0, mark.index).replace(QUESTION_LEAD_IN, '');
  return core.length > 0 ? core : null;
}

/**
 * P382 — a silence span with no named subject is the other side going
 * quiet: 「三个小时没回」「没回消息」 read as her silence in this
 * product's context, so the inferred subject is 她 — unless the span
 * was preceded by an explicit pronoun (「我三个小时没回她」).
 */
const SILENCE_SPAN =
  /^(?:(?:[0-9]+|[一二两三四五六七八九十半几]+)个?(?:分钟|小时|钟头|星期|个月|天|周|月|年)(?:没|不)(?:回|理|复|接|睬|应|找)|(?:没|不)回)/;

/** A bare trailing pronoun that was really the subject of the question. */
const TRAILING_SUBJECT = /(我们|对方|我|她|他|咱)$/;

/**
 * P382 — put the subject in front. A candidate already leading with
 * 她/他/我/我们/对方 is returned as-is (a leading 它/ta reads as 她);
 * a core cut out of a question can end on the pronoun that started it
 * (「明天第一次约会我该安排在」 → 「明天第一次约会我」), which moves
 * back up front when the body names no other pronoun. Otherwise an
 * explicit pronoun right before the matched span wins, a silent-phone
 * span belongs to 她, and every remaining clause is the user's own
 * plan or state — the subject is 我.
 */
function inferSubject(
  candidate: string,
  source: string,
  index: number,
  questionCore: boolean,
): string {
  const t = candidate.trim().replace(/^(ta|它)/i, '她');
  if (FACT_LEADING_SUBJECT.test(t)) return t;
  let body = t.replace(/^是/, '');
  const trailing = questionCore ? TRAILING_SUBJECT.exec(body) : null;
  if (trailing && !/[我你她他它]|ta/i.test(body.slice(0, -trailing[1].length))) {
    const pronoun = trailing[1] === '咱' ? '我们' : trailing[1];
    body = `${pronoun}${body.slice(0, -trailing[1].length)}`;
  }
  if (FACT_LEADING_SUBJECT.test(body)) return body;
  const before = /(我们|对方|她|他|我)$/.exec(source.slice(0, index))?.[1];
  if (before) return `${before}${body}`;
  if (SILENCE_SPAN.test(body)) return `她${body}`;
  return `我${body}`;
}

/**
 * P387 — hard interrogative rejection: a question the user asked is not
 * a fact about them. Four walkthrough rounds kept restating the user's
 * own question as a stored fact (「我明天直接当面质问她行不行」), so a
 * candidate is now dropped completely — never paraphrased, prefer
 * missing over wrong — when it
 *   - carries a question mark, or
 *   - contains a question/deliberation marker (吗 / 呢 / 行不行 /
 *     要不要 / 该不该 / 怎么 / 哪儿 / 哪里 / 什么 / 是不是 / 能不能 /
 *     可不可以), or
 *   - sits inside a clause that was uttered as a question: the first
 *     clause boundary after the candidate's offset is ?/？, so a
 *     marker-less question (「我们明天几点见面？」) still dies here.
 */
const FACT_INTERROGATIVE =
  /[?？]|吗|呢|行不行|要不要|该不该|怎么|哪儿|哪里|什么|是不是|能不能|可不可以/;

const FACT_CLAUSE_BOUNDARY = /[，。！？；、,.!?;\n]/;

/** Sentence terminals — ?/？ marks the whole sentence a question. */
const FACT_SENTENCE_END = /[。？！?!]/;

function isInterrogativeCandidate(
  raw: string,
  source: string,
  index: number,
): boolean {
  if (FACT_INTERROGATIVE.test(raw)) return true;
  const boundary = FACT_CLAUSE_BOUNDARY.exec(source.slice(index));
  if (boundary !== null && (boundary[0] === '？' || boundary[0] === '?')) {
    return true;
  }
  // P392 — a clause that cannot stand alone inside a question sentence
  // is the question's own topic fragment, never a fact: 「明天第一次约
  // 会，穿卫衣去会不会太随便？」 clips 「明天第一次约会」 as its topic
  // and the P387 clause-boundary check only saw the 「，」. A candidate
  // that already reads as a complete declarative (「她最近有点累」 in
  // 「她最近有点累，我是不是不该约了？」) stands on its own and lives.
  if (!isStandaloneFact(raw)) {
    const terminal = FACT_SENTENCE_END.exec(source.slice(index));
    return terminal !== null && (terminal[0] === '？' || terminal[0] === '?');
  }
  return false;
}

/**
 * P400 — the shaped text must also be grammatical: no duplicated
 * copula/subject (「我可能是我」「是是我」「我我」「她她」) and no two
 * 是 inside the first six characters. The Round-103R7 capsule listed
 * 「我可能是我自己不够好」 — inferSubject prepended 我 to a body that
 * already carried 我 after 是, leaving a copula + repeated subject no
 * reader can parse.
 */
const FACT_GRAMMAR_BROKEN =
  /我可能是我|是是我|是是你|是是他|是是她|我我|你你|她她|他他|我们我们|对方对方/;

/**
 * Deterministic repairs, applied in order: a prepended subject that
 * collided with the body's own 我 loses the copula + repeated subject
 * (「我可能是我(是)X」 → 「我可能X」), a doubled copula collapses, and a
 * repeated pronoun collapses to one. Each fix is a pure string rewrite
 * — no clock, no LLM, same input same output.
 */
const FACT_GRAMMAR_REPAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  [/我可能是我(?:是)?/u, '我可能'],
  [/是是+/gu, '是'],
  [/(我们|对方|我|你|她|他|它|ta)\1/giu, '$1'],
];

function factGrammarBroken(text: string): boolean {
  if (FACT_GRAMMAR_BROKEN.test(text)) return true;
  // Two 是 inside the first six characters is a duplicated copula.
  const head = text.slice(0, 6);
  return (head.match(/是/g) ?? []).length > 1;
}

/**
 * Repair a malformed candidate, or null when the deterministic fixes
 * still leave broken grammar — prefer missing over wrong.
 */
function repairFactGrammar(text: string): string | null {
  if (!factGrammarBroken(text)) return text;
  let fixed = text;
  for (const [re, to] of FACT_GRAMMAR_REPAIRS) {
    fixed = fixed.replace(re, to);
  }
  return factGrammarBroken(fixed) ? null : fixed;
}

/**
 * Shape one candidate into a storable fact: question-shaped candidates
 * are dropped outright (P387), the subject moves up front, malformed
 * text is repaired or dropped (P400), then the standalone gates
 * decide. Returns null when nothing readable remains.
 */
function shapeFact(raw: string, source: string, index: number): string | null {
  if (isInterrogativeCandidate(raw, source, index)) return null;
  const cored = declarativeCore(raw);
  if (cored === null) return null;
  const shaped = clip(inferSubject(cored, source, index, cored !== raw));
  const fact = repairFactGrammar(shaped);
  return fact !== null && isStandaloneFact(fact) ? fact : null;
}

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
      const label = shapeFact(rule.text(match), text, match.index);
      if (label === null) continue;
      candidates.push({ index: match.index, end: match.index + match[0].length, text: label });
    }
  }
  for (const pattern of CONVERSATION_FACT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const label = shapeFact(match[0], text, match.index);
      if (label === null) continue;
      candidates.push({
        index: match.index,
        end: match.index + match[0].length,
        text: label,
      });
    }
  }
  const lower = text.toLowerCase();
  for (const keyword of CONVERSATION_FACT_LEXICON) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index === -1) continue;
    const label = shapeFact(keyword, text, index);
    if (label === null) continue;
    candidates.push({ index, end: index + keyword.length, text: label });
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
      if (FACT_FILLER.includes(label.toLowerCase())) continue;
      if (OPEN_DELIBERATION.test(label)) continue;
      if (!CLAUSE_ANCHORS.test(label)) continue;
      const shaped = shapeFact(label, text, clause.index);
      if (shaped === null) continue;
      const key = factKey(shaped);
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      items.push({ key, text: shaped });
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
 * P376 — the session title is derived client-side from the first user
 * message (trimmed, 20 chars then an ellipsis). P382: a fact that only
 * restates the title adds no information at all — declarative or not,
 * it is dropped, so the capsule never shows the same sentence twice.
 */
const SESSION_TITLE_MAX = 20;

/**
 * The text the session title is derived from — the first user message,
 * or the message being processed when history is empty.
 */
function firstUserMessage(context: AgentContext, message: string): string {
  const first = (context.conversationHistory ?? []).find(
    (m) => m.role === 'user' && m.content.trim().length > 0,
  );
  return (first?.content ?? message).trim();
}

function sessionTitleText(context: AgentContext, message: string): string {
  const raw = firstUserMessage(context, message);
  if (raw.length <= SESSION_TITLE_MAX) return raw;
  const sliced = raw.slice(0, SESSION_TITLE_MAX).trimEnd();
  return sliced ? `${sliced}…` : '';
}

/**
 * P400 — normalised text for the verbatim gate: case, whitespace and
 * every punctuation mark are surface noise; what matters is the words.
 */
function verbatimKey(text: string): string {
  return text.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * P400 — the capsule/title dedupe key additionally drops tail
 * particles (了/的/啊/吧): 「她三天没回我消息了」 and 「她三天没回
 * 我消息」 name the same memory.
 */
function capsuleKey(text: string): string {
  return verbatimKey(text).replace(/[了的啊吧]+$/u, '');
}

/**
 * P400 — a fact that is a verbatim substring of the conversation title
 * or of the user's own first message is raw-sentence hoisting, not a
 * distilled statement: it is dropped (a rewrite like prepending the
 * missing subject already landed a different string, so anything still
 * verbatim is the raw clause).
 */
function verbatimEcho(factText: string, sourceKey: string): boolean {
  const fKey = verbatimKey(factText);
  return fKey.length > 0 && sourceKey.length > 0 && sourceKey.includes(fKey);
}

/**
 * P376 — character-bigram Dice similarity over normalised fact text.
 * Exported so the fact-shape test can assert pairwise distance between
 * stored facts; the merge below guarantees every stored pair stays
 * under 0.8.
 */
export function factSimilarity(a: string, b: string): number {
  const x = factKey(a);
  const y = factKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
    return out.size > 0 ? out : new Set([s]);
  };
  const ga = grams(x);
  const gb = grams(y);
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  return (2 * shared) / (ga.size + gb.size);
}

/**
 * P376 — a shared run of this many characters names the same event:
 * 「第一次约会」 sits inside both 「明天第一次约会」 and 「第一次约
 * 会安排在哪儿」, so two facts containing it are one memory, not two.
 */
const SAME_EVENT_MIN_RUN = 5;

/** Longest common substring length — fact keys stay under ~30 chars. */
function sharedRunLength(a: string, b: string): number {
  let best = 0;
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = b.length; j >= 1; j--) {
      dp[j] = a[i - 1] === b[j - 1] ? dp[j - 1] + 1 : 0;
      if (dp[j] > best) best = dp[j];
    }
  }
  return best;
}

/**
 * Whether two normalised fact keys name the same memory: identical or
 * contained text (sameFact), a shared event run, or near-duplicate
 * wording (similarity ≥ 0.8).
 */
function mergeableFact(a: string, b: string): boolean {
  return (
    sameFact(a, b) ||
    sharedRunLength(a, b) >= SAME_EVENT_MIN_RUN ||
    factSimilarity(a, b) >= 0.8
  );
}

/**
 * Fold one user message's facts into the session memory: forgotten keys
 * are never re-added, a fact identical to the session title is refused
 * (P382 — declarative echoes included: the title already says it), and
 * duplicates / same-event facts merge — the longer wording carries more
 * information, so it replaces the stored row in place while keeping the
 * first-stated timestamp. The list is capped at SESSION_MEMORY_MAX.
 * Returns the live fact array.
 */
export function rememberUserMessage(
  context: AgentContext,
  message: string,
  ts: number = Date.now(),
): MemoryFact[] {
  const facts = (context.memoryFacts ??= []);
  const forgotten = (context.forgottenFactKeys ??= new Set<string>());
  const tKey = verbatimKey(sessionTitleText(context, message));
  const sourceKey = verbatimKey(firstUserMessage(context, message));
  // The title / the user's own first message already states this fact —
  // drop such rows even when a pre-P382 shard carried them over (P400:
  // verbatim substring now counts, not just an identical sentence).
  if (tKey.length > 0 || sourceKey.length > 0) {
    for (let i = facts.length - 1; i >= 0; i--) {
      if (verbatimEcho(facts[i].text, tKey) || verbatimEcho(facts[i].text, sourceKey)) {
        facts.splice(i, 1);
      }
    }
  }
  for (const fact of extractMemoryFacts(message)) {
    if (forgotten.has(fact.key)) continue;
    if (verbatimEcho(fact.text, tKey) || verbatimEcho(fact.text, sourceKey)) continue;
    const mergeIndex = facts.findIndex((f) => mergeableFact(f.key, fact.key));
    if (mergeIndex !== -1) {
      if (fact.key.length > facts[mergeIndex].key.length) {
        facts[mergeIndex] = {
          key: fact.key,
          text: fact.text,
          ts: facts[mergeIndex].ts,
        };
      }
      continue;
    }
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

/** History split into clauses, terminal punctuation kept. */
const HISTORY_CLAUSE = /[^，。！？；、,.!?;\n]+[，。！？；、,.!?;\n]?/g;

/**
 * P392 — a stored fact whose only trace in the history is inside a
 * question was clipped out of the user's own question (「我明天第一次
 * 约会」 out of 「明天第一次约会，穿卫衣去会不会太随便？」): it was
 * never stated, so it is pruned on read. An occurrence inside a
 * declarative clause — the full text verbatim, or the de-subjected core
 * inside a subject-led clause (「她说最近有点累」 keeps 「她最近有点
 * 累」 even though the 说 was dropped) — means the user really stated
 * it and the fact stays.
 */
function factOnlyEchoesQuestion(context: AgentContext, text: string): boolean {
  const core = text.replace(FACT_LEADING_SUBJECT, '');
  let echo = false;
  for (const message of context.conversationHistory ?? []) {
    if (message.role !== 'user') continue;
    for (const clause of message.content.matchAll(HISTORY_CLAUSE)) {
      const c = clause[0];
      const index = clause.index ?? 0;
      if (!(c.includes(text) || (core.length >= 4 && c.includes(core)))) {
        continue;
      }
      // A clause ending in ? is a question; a non-standalone clause is
      // the topic fragment of whatever sentence it opens — question or
      // not — decided by that sentence's terminal punctuation.
      let question = /[？?]$/.test(c);
      if (!question && !FACT_LEADING_SUBJECT.test(c.trim())) {
        const terminal = FACT_SENTENCE_END.exec(message.content.slice(index));
        question =
          terminal !== null && (terminal[0] === '？' || terminal[0] === '?');
      }
      if (!question) return false;
      echo = true;
    }
  }
  return echo;
}

/**
 * The remembered facts in first-stated order. P392 — the list is
 * re-validated on every read because a shard written before the
 * interrogative / fragment / title gates still serves whatever it
 * holds on refresh: a fact dies when it is itself interrogative or
 * fragmentary, echoes the session title, or only ever appeared inside
 * a question sentence. Prefer missing over wrong.
 */
export function sessionMemoryFacts(context: AgentContext): MemoryFact[] {
  const facts = context.memoryFacts ?? [];
  if (facts.length === 0) return facts;
  const tKey = verbatimKey(sessionTitleText(context, ''));
  const sourceKey = verbatimKey(firstUserMessage(context, ''));
  for (let i = facts.length - 1; i >= 0; i--) {
    const { text } = facts[i];
    if (
      FACT_INTERROGATIVE.test(text) ||
      !isStandaloneFact(text) ||
      factGrammarBroken(text) ||
      verbatimEcho(text, tKey) ||
      verbatimEcho(text, sourceKey) ||
      factOnlyEchoesQuestion(context, text)
    ) {
      facts.splice(i, 1);
    }
  }
  // P400 — normalised-substring dedupe: punctuation, whitespace and
  // tail particles (了/的/啊/吧) are stripped before comparing, so two
  // facts whose keys contain one another name the same memory. The
  // longer wording stays; a tie keeps the first-stated row. Ordering
  // and SESSION_MEMORY_MAX are untouched.
  for (let i = facts.length - 1; i >= 0; i--) {
    const ki = capsuleKey(facts[i].text);
    if (ki.length === 0) {
      facts.splice(i, 1);
      continue;
    }
    const swallowed = facts.some((f, j) => {
      if (j === i) return false;
      const kj = capsuleKey(f.text);
      if (kj === ki) return j < i;
      return ki.length >= 4 && kj.includes(ki);
    });
    if (swallowed) facts.splice(i, 1);
  }
  return facts;
}
