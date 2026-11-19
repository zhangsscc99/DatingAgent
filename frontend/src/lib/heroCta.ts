/**
 * P367 — the narrow first screen had no explicit primary action: every
 * hero control had been demoted to passive copy and the only start
 * entry was one small hint line. The first fix was three one-tap
 * example cards that send immediately through the composer's own send
 * path — never a prefill, since a prefilled prompt is the dead option
 * P345 removed.
 *
 * P374 — measured again at 390×844, the card group itself became the
 * competition: a 334×174 role=group of three equal-weight accent
 * cards under a 「点一条，直接发送」 lead, where tapping the "primary
 * CTA" fired a canned question instead of focusing the composer. The
 * hero now carries ONE real primary button — HERO_PRIMARY_LABEL —
 * whose whole job is focusing #chat-input (it sends nothing), while
 * the prompts live on as a secondary, lighter group that still sends
 * on tap. The copy lives here so the component maps one shared list
 * instead of hard-coding it (same convention as heroHint.ts and
 * starterEntries.ts).
 */
export const HERO_PRIMARY_LABEL = '说说你的情况';

/** Each prompt is a safe, concrete mobile-first first message: short
 *  enough to read on one card, real enough that the reply is useful. */
export const HERO_EXAMPLE_PROMPTS: readonly string[] = [
  '她三天没回我消息，我该怎么办？',
  '第一次约会安排在哪儿比较好？',
  '她回消息总是很冷淡，怎么聊下去？',
];
