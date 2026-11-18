/**
 * P334 — render guard mirroring the backend fillBracketSlots pass
 * (backend/src/lib/reply-clean.ts). A reply is promised to be sendable
 * as-is, so a template slot that survived the server (「看那个[某部电影/展]」)
 * must still never reach the DOM: the same deterministic mapping, the same
 * 「first alternative, 某个X → 一个X」 fallback, and the same 「附近一家不错
 * 的店」 last resort apply here. No bracket pair survives the output.
 */

// An unfilled slot looks like […] or 【…】 — 1–20 chars inside, no newline.
// The lookahead keeps Markdown link targets [text](url) intact.
const SLOT_BRACKET = /\[([^\][\n]{1,20})\](?!\s*\()|【([^【】\n]{1,20})】(?!\s*\()/g;
const HAS_BRACKET = /[[【]/;

// Spans that must never be rewritten — fenced code, inline `code`, URLs.
const PROTECTED_SPAN = /```[\s\S]*?(?:```|$)|`[^`\n]*`|https?:\/\/\S+/gu;

const SLOT_MEASURE = '个家部场首本杯顿份条道只次回种样位段层间趟句件张碗瓶双对副支所些';
const QUANTIFIED_PHRASE = new RegExp(`^一[${SLOT_MEASURE}]`);

// A trailing quantifier phrase belongs to the slot (「那个」「一家很棒的」) —
// dropping it keeps a quantified replacement from doubling up.
const SLOT_INTRO = new RegExp(
  `(?:[那这一俩几][${SLOT_MEASURE}])` +
    `(?:(?![你我他她它这那把被让请跟和与在看听吃喝玩逛买送约说问想找带做去来是有没最刚已正])` +
    `[^，。！？：；、\\n\\s]{2,4}的)?` +
    `[ \\t]*$`,
);

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
  const first = inner.split(/[/／|｜、,，;；]/u)[0]?.trim() ?? '';
  for (const [pattern, phrase] of SLOT_PHRASES) {
    if (pattern.test(first)) return phrase;
  }
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

/** Assistant-reply text with every […]/【…】 slot replaced by a natural phrase. */
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
