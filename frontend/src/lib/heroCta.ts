/**
 * P367 — the narrow first screen had no explicit primary action: every
 * hero control had been demoted to passive copy and the only start
 * entry was one small hint line. The fix is three one-tap example
 * cards that SEND immediately through the composer's own send path —
 * never a prefill, since a prefilled prompt is the dead option P345
 * removed. The prompts live here so the component maps one shared
 * list instead of hard-coding copy (same convention as heroHint.ts
 * and starterEntries.ts).
 *
 * Each prompt is a safe, concrete mobile-first first message: short
 * enough to read on one card, real enough that the reply is useful.
 */
export const HERO_EXAMPLE_PROMPTS: readonly string[] = [
  '她三天没回我消息，我该怎么办？',
  '第一次约会安排在哪儿比较好？',
  '她回消息总是很冷淡，怎么聊下去？',
];
