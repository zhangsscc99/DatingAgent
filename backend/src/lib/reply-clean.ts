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
