import type { Message } from '../agent/types.js';

/**
 * P233 — cross-turn person-reference focus. Live sampling showed the model
 * answering a 「她答应了…」 turn by still talking about 「妈妈」 from the
 * previous turn: whichever person was named most recently bleeds into the
 * next question. These pure helpers pick the person the CURRENT message is
 * about, list the people only the previous turns mentioned, and phrase a
 * one-line constraint the harness appends to the system prompt.
 */

const PERSON_TERMS: readonly string[] = [
  '我妈',
  '我妈妈',
  '妈妈',
  '我爸',
  '我爸爸',
  '爸爸',
  '女朋友',
  '男朋友',
  '女友',
  '男友',
  '老婆',
  '老公',
  '前任',
  '前女友',
  '前男友',
  '相亲对象',
  '对方',
  '她',
  '他',
];

/** Longest first so 「我妈妈」 wins over 「妈妈」 at the same position. */
const TERMS_LONGEST_FIRST: readonly string[] = [...PERSON_TERMS].sort(
  (a, b) => b.length - a.length,
);

/** Surface forms that all name the same person collapse to one canonical term. */
const CANONICAL_TERM: Record<string, string> = {
  我妈: '妈妈',
  我妈妈: '妈妈',
  我爸: '爸爸',
  我爸爸: '爸爸',
  女友: '女朋友',
  男友: '男朋友',
};

function canonicalTerm(term: string): string {
  return CANONICAL_TERM[term] ?? term;
}

/**
 * Person terms appearing in `text`, in first-appearance order, deduplicated.
 * Matching is greedy left-to-right and longest-first, so a term inside an
 * already-consumed longer match (「女友」 inside 「女朋友」) is not reported.
 */
export function extractPersonTerms(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const term of TERMS_LONGEST_FIRST) {
      if (text.startsWith(term, i)) {
        if (!seen.has(term)) {
          seen.add(term);
          found.push(term);
        }
        i += term.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return found;
}

export interface FocusEntityResult {
  /** First person term in the current message, or null when it names nobody. */
  focus: string | null;
  /** Canonical person terms from the last two history turns absent from the current message. */
  staleTerms: string[];
  /** One-sentence prompt constraint, '' when nothing needs constraining. */
  directive: string;
}

/** Newest `count` history entries that are real user/assistant turns. */
function lastTurns(history: Message[], count: number): Message[] {
  const picked: Message[] = [];
  for (let i = history.length - 1; i >= 0 && picked.length < count; i--) {
    const entry = history[i];
    if (entry.role === 'user' || entry.role === 'assistant') {
      picked.unshift(entry);
    }
  }
  return picked;
}

export function resolveFocusEntity(
  history: Message[],
  currentMessage: string,
): FocusEntityResult {
  const currentTerms = extractPersonTerms(currentMessage);
  const focus = currentTerms[0] ?? null;
  const currentCanonical = new Set(currentTerms.map(canonicalTerm));

  const staleTerms: string[] = [];
  const seenStale = new Set<string>();
  for (const entry of lastTurns(history, 2)) {
    for (const term of extractPersonTerms(entry.content)) {
      const canonical = canonicalTerm(term);
      if (currentCanonical.has(canonical) || seenStale.has(canonical)) continue;
      seenStale.add(canonical);
      staleTerms.push(canonical);
    }
  }

  let directive = '';
  if (focus !== null && staleTerms.length > 0) {
    const staleList = staleTerms.map((term) => `「${term}」`).join('、');
    const pronoun = staleTerms.length > 1 ? '这些人' : '这个人';
    directive =
      `本轮只讨论：${focus}。上一轮出现的${staleList}不是本轮的对象；` +
      `除非用户在本轮自己提到，回复中不要出现${pronoun}。`;
  }

  return { focus, staleTerms, directive };
}
