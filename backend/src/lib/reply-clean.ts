/**
 * P242 — reply-clean layer. Emotionally fragile input can make the model
 * slip into a lover persona and emit parenthesised stage directions
 * (「（轻轻揉了揉你的头发）」「(sighs)」). stripStageDirections removes
 * those （）/() spans while keeping the surrounding body text, then folds
 * the blank lines and stray spaces the removal leaves behind. Replies
 * with no parenthesised spans are returned byte-identical.
 */
// The `(?<\!\])` guard keeps Markdown link targets `[text](url)` intact —
// only full-width （） and bare () spans count as stage directions.
const STAGE_DIRECTION = /（[^（）\n]*）|(?<!\])\([^()\n]*\)/g;

export function stripStageDirections(text: string): string {
  const stripped = text.replace(STAGE_DIRECTION, '');
  if (stripped === text) return text;
  return stripped
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// P279: any Extended_Pictographic emoji at line start counts, except the
// ASCII keycap bases (0-9, #, *) — those are EP code points too but a
// leading digit is a numbered item, not decoration.
const LEADING_EMOJI = new RegExp('^[\\p{Extended_Pictographic}--[0-9#*]]+[ \\t]*', 'v');
const MANUAL_LABEL = /^(?:解析|避坑指南)[：:][ \t]*/;

// P373: a reply that opens with an interface/tool label (「排约会」「关系
// 建议」…), optionally followed by a bare ✓ line, is chip feedback that
// leaked into the reply body — the chip strip outside the bubble renders
// that channel, so the body copy drops it. Anchored to position 0 only:
// the same words mid-sentence are legitimate content.
const INTERFACE_CHIP_LEAD =
  /^[ \t]*(?:排约会|接话术|改资料|看匹配|关系建议|我们合不合适)[ \t]*\r?\n?[ \t]*✓?[ \t]*\r?\n/;

/**
 * P279 — strips manual-style scaffolding the model sometimes wraps advice
 * in: a leading emoji on a line (「💡 避坑指南：…」) and the literal labels
 * 「解析：」「避坑指南：」. The text after a label is kept. Runs of 3+
 * newlines are folded to one blank line. Replies with none of this are
 * returned byte-identical.
 */
export function stripManualLabels(text: string): string {
  return text
    .replace(INTERFACE_CHIP_LEAD, '')
    .split('\n')
    .map((line) => line.replace(LEADING_EMOJI, '').replace(MANUAL_LABEL, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// P286: a leading sentence is prompt echo only when it *opens* with a
// meta-narration phrase (「按规则…」「根据要求…」). 「规则」 appearing
// mid-sentence in a normal opening does not match.
const PROMPT_ECHO_LEAD = /^(?:按规则|按约束|按照规则|按照约束|按照要求|根据规则|根据要求|规则要求我|按要求)[，,、 ：:]?[^。！？!?\n「]*[。！？!?\n]/;

/**
 * P286 — the example-first rule occasionally leaks meta-reasoning as the
 * reply's first sentence (「按规则第一段必须先给…」) before the actual
 * example. stripPromptEcho removes that single leading sentence — at most
 * one, and only when the reply starts with a meta phrase — so the sample
 * copy that follows it survives. 「…」-wrapped text is never touched:
 * a lead-in containing a quoted example is left alone.
 */
export function stripPromptEcho(text: string): string {
  const match = PROMPT_ECHO_LEAD.exec(text);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^[ \t\n]+/, '');
}

// P282: spans that must never be rewritten — fenced code blocks (unclosed
// trailing fences included), inline `code`, and URLs.
const PROTECTED_SPAN = /```[\s\S]*?(?:```|$)|`[^`\n]*`|https?:\/\/\S+/gu;

// `,`/`?`/`!` convert when directly between two Han characters or directly
// after a Han character at end-of-sentence (followed by whitespace or end).
const HALF_AFTER_HAN = /(?<=\p{Script=Han})[,?!](?=[\p{Script=Han}\s]|$)/gu;
// `:` converts only directly after a Han character when followed by a Han
// character or whitespace, so「12:30」and「https://…」stay intact.
const COLON_AFTER_HAN = /(?<=\p{Script=Han}):(?=[\p{Script=Han}\s])/gu;

const FULL_WIDTH: Record<string, string> = { ',': '，', '?': '？', '!': '！' };

function convertSegment(segment: string): string {
  return convertQuoteSegment(
    segment
      .replace(HALF_AFTER_HAN, (ch) => FULL_WIDTH[ch] ?? ch)
      .replace(COLON_AFTER_HAN, '：'),
  );
}

/**
 * P282 — the model occasionally leaks half-width `,` `?` `!` `:` next to Han
 * characters (「等了,把手机放远一点?」). normalizeChinesePunctuation rewrites
 * only those to full-width，？！： — pure-ASCII segments, fenced/inline code
 * and URLs are returned byte-identical, and digit-adjacent marks like
 * 「1,000」/「12:30」have no Han neighbour so they are never touched. The
 * function is idempotent: full-width output no longer matches the rules.
 *
 * P289 — the same input-method residue also produced paired half-width
 * straight "…" around Chinese phrases (「而不是"完成任务"」). This function
 * now runs the P292 pair conversion too — Chinese-context pairs are
 * normalised to 「…」 (the corner-bracket style the rest of the product
 * already uses), and a stray space after an opening mark before a latin
 * word (「" rejection"」) is dropped. Unpaired marks stay literal.
 */
export function normalizeChinesePunctuation(text: string): string {
  if (!/\p{Script=Han}/u.test(text)) return text;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PROTECTED_SPAN)) {
    out += convertSegment(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + convertSegment(text.slice(last));
}

// P292: a quote pair counts as Chinese-context when its inner text holds a
// Han character or either quote mark sits directly next to one.
const HAN_CHAR = /\p{Script=Han}/u;
const CURLY_QUOTE_PAIR = /“([^“”\n]*)”/g;

function hanAdjacent(text: string, index: number): boolean {
  return HAN_CHAR.test(text[index] ?? '');
}

function isCjkQuoteContext(segment: string, open: number, close: number, inner: string): boolean {
  return HAN_CHAR.test(inner) || hanAdjacent(segment, open - 1) || hanAdjacent(segment, close + 1);
}

// P289: a space right after the opening mark in front of a latin word is
// stray input-method residue (「" rejection"」) — drop the space, keep the
// word. Applied only to pairs being rewritten to 「」, so English-context
// quotes keep their original spacing byte-identical.
const INNER_LATIN_LEAD_SPACE = /^[ \t]+(?=[A-Za-z])/;

function convertQuoteSegment(segment: string): string {
  const withCurly = segment.replace(CURLY_QUOTE_PAIR, (match, inner: string, offset: number) =>
    isCjkQuoteContext(segment, offset, offset + match.length - 1, inner)
      ? `「${inner.replace(INNER_LATIN_LEAD_SPACE, '')}」`
      : match,
  );
  // Straight `"` has no distinct open/close glyph — pair each `"` with the
  // next one on the same line, left to right; an unmatched `"` stays literal.
  let out = '';
  let cursor = 0;
  while (cursor < withCurly.length) {
    const open = withCurly.indexOf('"', cursor);
    if (open === -1) break;
    const close = withCurly.indexOf('"', open + 1);
    const newline = withCurly.indexOf('\n', open + 1);
    if (close === -1 || (newline !== -1 && newline < close)) {
      out += withCurly.slice(cursor, open + 1);
      cursor = open + 1;
      continue;
    }
    const inner = withCurly.slice(open + 1, close);
    out +=
      withCurly.slice(cursor, open) +
      (isCjkQuoteContext(withCurly, open, close, inner)
        ? `「${inner.replace(INNER_LATIN_LEAD_SPACE, '')}」`
        : `"${inner}"`);
    cursor = close + 1;
  }
  return out + withCurly.slice(cursor);
}

// P306: a half-width space or nbsp directly after a full-width 。！？ is a
// stray ASCII residue — remove it, but only on lines that contain Han
// characters so predominantly English lines stay byte-identical.
const SPACE_AFTER_CJK_END = /([。！？])[ \u00a0]+/g;

function convertSpaceSegment(segment: string): string {
  return segment
    .split('\n')
    .map((line) => (HAN_CHAR.test(line) ? line.replace(SPACE_AFTER_CJK_END, '$1') : line))
    .join('\n');
}

/**
 * P306 — the model sometimes leaves a half-width space or \u00a0 right
 * after full-width 。！？ (「。 看展本身就是…」). stripSpaceAfterCjkPunct
 * removes those spaces only on lines containing Han characters: fenced
 * code blocks, inline `code`, URLs and predominantly-English lines pass
 * through byte-identical. The function is idempotent.
 */
export function stripSpaceAfterCjkPunct(text: string): string {
  if (!HAN_CHAR.test(text)) return text;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PROTECTED_SPAN)) {
    out += convertSpaceSegment(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + convertSpaceSegment(text.slice(last));
}

/**
 * P292 — the model occasionally wraps Chinese phrases in English curly
 * “…” or half-width straight "…" quotes while the rest of the reply uses
 * 「」. normalizeCjkQuotes rewrites a pair to 「…」 only when it sits in a
 * Chinese context (Han inside or directly beside the pair): pure-English
 * quotes like "hello" and unpaired lone marks pass through byte-identical,
 * as do fenced/inline code and URLs. The function is idempotent.
 */
export function normalizeCjkQuotes(text: string): string {
  if (!HAN_CHAR.test(text)) return text;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PROTECTED_SPAN)) {
    out += convertQuoteSegment(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + convertQuoteSegment(text.slice(last));
}

// P334: an unfilled slot looks like […] or 【…】 — 1–20 chars inside, no
// newline. The lookahead keeps Markdown link targets [text](url) intact.
const SLOT_BRACKET = /\[([^\][\n]{1,20})\](?!\s*\()|【([^【】\n]{1,20})】(?!\s*\()/g;
const HAS_BRACKET = /[[【]/;

// Measure words a quantified fallback phrase can start with (一部电影).
const SLOT_MEASURE = '个家部场首本杯顿份条道只次回种样位段层间趟句件张碗瓶双对副支所些';
const QUANTIFIED_PHRASE = new RegExp(`^一[${SLOT_MEASURE}]`);

// A trailing quantifier phrase — 「那个」「一家很棒的」 — belongs to the
// slot itself: dropping it keeps a quantified replacement from doubling up
// (「看那个一部电影」→「看一部电影」). The quantifier is required, so a bare
// adjective like 「一直很棒的」 stays to describe the replacement; the
// leading-char stoplist keeps clause openers like 「我最近很火的」 from
// being eaten as the adjective.
const SLOT_INTRO = new RegExp(
  `(?:[那这一俩几][${SLOT_MEASURE}])` +
    `(?:(?![你我他她它这那把被让请跟和与在看听吃喝玩逛买送约说问想找带做去来是有没最刚已正])` +
    `[^，。！？：；、\\n\\s]{2,4}的)?` +
    `[ \\t]*$`,
);

// Common slot nouns → a generic phrase that always reads as a finished
// sentence. Matched against the first alternative inside the bracket.
const SLOT_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/展|画廊|美术馆|博物馆/, '一个新开的展'],
  [/电影|影片|院线/, '一部电影'],
  [/咖啡|下午茶|甜品|奶茶|餐|饭|火锅|烧烤|日料|小吃|菜|店|馆|吧|食堂|居酒屋/, '一家挺有氛围的小店'],
  [/公园|景点|去处|江边|海边|湖|山|徒步|露营|野餐|城市|地方|位置|地址|地点|哪儿|哪里|某地|某处/, '一个附近不错的地方'],
  [/演出|演唱会|脱口秀|话剧|音乐剧|乐队|live|livehouse|音乐节/i, '一场不错的演出'],
  [/歌|专辑|曲子/, '一首新歌'],
  [/书|小说|漫画|文章|播客/, '一本不错的书'],
  [/礼物|惊喜/, '一份小礼物'],
  [/运动|健身|球|游泳|瑜伽|爬山|活动|项目/, '一个轻松的活动'],
  [/话题|开场|问题|梗/, '一个轻松的话题'],
  [/时间|日期|时候|周[几末]|哪天|某日|某天|何时/, '周六下午'],
  [/游戏|剧本杀|密室/, '一个新出的游戏'],
];

// Mapped phrases are self-contained noun phrases — a preceding 「那个」 or
// 「一家很棒的」 belongs to the slot and gets dropped. A bare generic fill
// (「朋友」) keeps it, since it correctly describes the inserted noun.
const SELF_CONTAINED = new Set<string>([...SLOT_PHRASES.map(([, p]) => p), '附近一家不错的店']);

function slotFallback(inner: string): string {
  // 「某部电影/展」 lands on the movie phrase via its first alternative.
  const first = inner.split(/[/／|｜、,，;；]/u)[0]?.trim() ?? '';
  for (const [pattern, phrase] of SLOT_PHRASES) {
    if (pattern.test(first)) return phrase;
  }
  // Generic fill: drop the placeholder marker 某 and repair a leading
  // measure word (某个App → 一个App); a footnote marker ^x unwraps to x.
  const filled = first
    .replace(/^某+/u, '')
    .replace(new RegExp(`^([${SLOT_MEASURE}])`, 'u'), '一$1')
    .replace(/^\^+/u, '');
  // Nothing sensible — empty, a bare xxx/*** marker or pure punctuation.
  if (!filled || /^[xX＊*_\s]+$/.test(filled) || !/[\p{L}\p{N}]/u.test(filled)) {
    return '附近一家不错的店';
  }
  return filled;
}

function fillSlotSegment(segment: string): string {
  let out = '';
  let last = 0;
  for (const match of segment.matchAll(SLOT_BRACKET)) {
    const phrase = slotFallback(match[1] ?? match[2] ?? '');
    out += segment.slice(last, match.index);
    last = match.index + match[0].length;
    if (SELF_CONTAINED.has(phrase) || QUANTIFIED_PHRASE.test(phrase)) {
      out = out.replace(SLOT_INTRO, '');
    }
    out += phrase;
  }
  return out + segment.slice(last);
}

/**
 * P334 — the model sometimes emits copy-ready lines with the template slot
 * still in place (「一直想去看那个[某部电影/展]」「发现一家很棒的[咖啡馆/展览]」),
 * leaking the fill-in-the-blank structure the product promises to hide.
 * fillBracketSlots rewrites every surviving […]/【…】 slot (1–20 chars, no
 * newline; Markdown link targets [text](url) excluded) into a generic
 * phrase that reads correctly in the sentence: the deterministic table
 * covers the usual venue/activity slots, the generic fallback unwraps the
 * first alternative (某个X → 一个X), and a slot with nothing sensible falls
 * back to 「附近一家不错的店」. Fenced/inline code and URLs pass through
 * untouched, no bracket pair survives, and the function is idempotent.
 */
export function fillBracketSlots(text: string): string {
  if (!HAS_BRACKET.test(text)) return text;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PROTECTED_SPAN)) {
    out += fillSlotSegment(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + fillSlotSegment(text.slice(last));
}

// P406: the model keeps reaching for a small kit of consulting-jargon
// metaphors (「新鲜感退潮」「热度自然回落」「消耗自己」) that made the Round
// 103 replies read like template paste-ups. The mapping below rewrites
// each term to everyday wording; the prompt bans the same list, exported
// here so the rule and the cleaner share one source of truth.
export const CLINIC_TERMS = ['新鲜感退潮', '热度自然回落', '消耗自己', '情感账户'] as const;

// P406: same spans as PROTECTED_SPAN, plus quoted user speech (「…」 and
// “…”) — a jargon term the user wrote, or one inside a quote the reply
// cites, is not the reply's own voice and must survive untouched.
const CLINIC_PROTECTED_SPAN =
  /```[\s\S]*?(?:```|$)|`[^`\n]*`|「[^」\n]*」|“[^”\n]*”|https?:\/\/\S+/gu;

// The verb-phrase terms absorb a trailing 了 so 「热度自然回落了」 and
// 「热度自然回落」 both land on natural wording without a doubled particle.
const CLINIC_TERM_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/新鲜感退潮了?/g, '没那么新鲜了'],
  [/热度自然回落了?/g, '联系少了些'],
  [/消耗自己/g, '勉强自己'],
  [/情感账户/g, '感情'],
];

function softenClinicSegment(segment: string): string {
  let out = segment;
  for (const [pattern, replacement] of CLINIC_TERM_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * P406 — replaces the consulting-jargon terms in CLINIC_TERMS with plain
 * everyday phrasing (「热度自然回落」→「联系少了些」, 「消耗自己」→「勉强自己」).
 * Fenced code blocks, inline `code`, 「…」/“…” quoted user speech and URLs
 * are protected spans and pass through byte-identical, as does any text
 * with none of the terms. The function is idempotent: no replacement
 * output contains a banned term, so a second pass changes nothing.
 */
export function softenClinicTerms(text: string): string {
  if (!CLINIC_TERMS.some((term) => text.includes(term))) return text;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(CLINIC_PROTECTED_SPAN)) {
    out += softenClinicSegment(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + softenClinicSegment(text.slice(last));
}
