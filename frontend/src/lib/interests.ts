/**
 * P191 — interests parsing/formatting shared by onboarding, profile edit and
 * any single-line display. Users paste interests with whatever separators they
 * have (commas, Chinese commas/顿号, semicolons, slashes, spaces, newlines);
 * the field must not silently collapse "徒步 摄影 烹饪" into one interest.
 */

const ITEM_MAX = 20;
const LIST_MAX = 12;

// `,` `，` `、` `;` `；` `/` plus any whitespace run — \s already covers the
// full-width space U+3000, tabs and newlines.
const SEPARATORS = /[,，、;；/\s]+/;

export function parseInterests(raw: string | undefined | null): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of raw.split(SEPARATORS)) {
    const item = chunk.trim().slice(0, ITEM_MAX).trimEnd();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= LIST_MAX) break;
  }
  return out;
}

export function formatInterests(list: string[] | undefined | null): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list.join('、');
}
