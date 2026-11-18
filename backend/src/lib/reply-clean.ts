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

/**
 * P279 — strips manual-style scaffolding the model sometimes wraps advice
 * in: a leading emoji on a line (「💡 避坑指南：…」) and the literal labels
 * 「解析：」「避坑指南：」. The text after a label is kept. Runs of 3+
 * newlines are folded to one blank line. Replies with none of this are
 * returned byte-identical.
 */
export function stripManualLabels(text: string): string {
  return text
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
  return segment
    .replace(HALF_AFTER_HAN, (ch) => FULL_WIDTH[ch] ?? ch)
    .replace(COLON_AFTER_HAN, '：');
}

/**
 * P282 — the model occasionally leaks half-width `,` `?` `!` `:` next to Han
 * characters (「等了,把手机放远一点?」). normalizeChinesePunctuation rewrites
 * only those to full-width，？！： — pure-ASCII segments, fenced/inline code
 * and URLs are returned byte-identical, and digit-adjacent marks like
 * 「1,000」/「12:30」have no Han neighbour so they are never touched. The
 * function is idempotent: full-width output no longer matches the rules.
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

function convertQuoteSegment(segment: string): string {
  const withCurly = segment.replace(CURLY_QUOTE_PAIR, (match, inner: string, offset: number) =>
    isCjkQuoteContext(segment, offset, offset + match.length - 1, inner)
      ? `「${inner}」`
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
      (isCjkQuoteContext(withCurly, open, close, inner) ? `「${inner}」` : `"${inner}"`);
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
