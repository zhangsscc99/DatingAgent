/**
 * P398 — terminal completeness check for a settled reply.
 *
 * Round 102 (walk-1795122630) measured the stream ending mid-thought: one
 * reply stopped on 「在给你建议之前，我想先了解一些情况：」 and another
 * delivered a single bullet of a list it had announced several of. A reply
 * that fails isReplyIncomplete is continued once (the partial stays on
 * screen, the follow-up is merged in); still failing, the bubble wears a
 * 回答中断 · 重试 footer instead of silently keeping half an answer.
 */

/**
 * The internal follow-up sent exactly once when a settled reply fails the
 * check. It reads as an ordinary user turn to the backend — the truncated
 * assistant message is already in session history, so the model can pick
 * the sentence back up.
 */
export const REPLY_CONTINUATION_PROMPT =
  '请接着你上一条回答继续写完，不要重复已经写过的内容。';

/** Trailing marks that can only mean the thought was cut off mid-clause. */
const DANGLING_TAIL = /[：、，:,]\s*$/u;

/** 「三个建议」「以下 2 个方面」「几个原因」 — a promised item count. */
const COUNT_DECLARATION =
  /([0-9０-９]+|[一二两三四五六七八九十]{1,3}|几)\s*(?:个|条|点|项|步|种|方面|处)/g;

/** One markdown / CJK-enumerated list row: `- x`, `* x`, `1. x`, `2、x`, `一、x`. */
const LIST_ITEM_LINE =
  /^\s*(?:[-*+•]|(?:[0-9０-９]{1,3}|[一二三四五六七八九十]{1,3})\s*[.、）\)])/;

/** A bare trailing marker (`-`, `2.`, `三、`) — the announced item never arrived. */
const BARE_MARKER_TAIL =
  /(?:^|\n)\s*(?:[-*+]|(?:[0-9０-９]{1,3}|[一二两三四五六七八九十]{1,3})\s*[.、）\)])\s*$/;

const CJK_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Arabic or simple-CJK numerals (一…九, 十, X十, 十X, X十Y); 「几」 promises at least two. */
function declaredCount(raw: string): number {
  if (/^[0-9０-９]+$/.test(raw)) {
    return Number.parseInt(
      raw.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)),
      10,
    );
  }
  if (raw === '几') return 2;
  const ten = raw.indexOf('十');
  if (ten === -1) return raw.length === 1 ? (CJK_DIGIT[raw] ?? 0) : 0;
  const high = ten === 0 ? 1 : (CJK_DIGIT[raw[0]] ?? 0);
  const low =
    ten === raw.length - 1 ? 0 : (CJK_DIGIT[raw[ten + 1]] ?? Number.NaN);
  if (!high || Number.isNaN(low)) return 0;
  return high * 10 + low;
}

/**
 * True when the settled reply text still reads as unfinished: it ends on a
 * dangling colon / enumeration comma, on a bare list marker, or it
 * announced more list items (「N 个/点/条」) than it delivered. A reply
 * that only mentions a count in prose — no list markers at all — is not
 * flagged.
 */
export function isReplyIncomplete(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  if (DANGLING_TAIL.test(trimmed)) return true;
  if (BARE_MARKER_TAIL.test(trimmed)) return true;
  const items = trimmed
    .split('\n')
    .filter((line) => LIST_ITEM_LINE.test(line)).length;
  if (items === 0) return false;
  let promised = 0;
  for (const match of trimmed.matchAll(COUNT_DECLARATION)) {
    promised = Math.max(promised, declaredCount(match[1]));
  }
  return promised >= 2 && items < promised;
}

/**
 * Fold a continuation stream's authoritative text into the partial already
 * on screen. The model may return only the missing tail, restate the whole
 * answer, or echo the cut fragment before continuing — all three collapse
 * to base + the genuinely new suffix.
 */
export function mergeReplyContinuation(base: string, addition: string): string {
  if (!addition.trim()) return base;
  if (!base.trim()) return addition;
  // The model restated the reply from the top — its version is whole.
  if (addition.startsWith(base)) return addition;
  // The addition opens by repeating the seed's tail — overlap once, not twice.
  const maxOverlap = Math.min(base.length, addition.length);
  for (let k = maxOverlap; k > 0; k--) {
    if (base.endsWith(addition.slice(0, k))) return base + addition.slice(k);
  }
  return base + addition;
}
