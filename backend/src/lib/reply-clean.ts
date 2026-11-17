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
