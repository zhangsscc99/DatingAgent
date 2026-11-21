/**
 * P407 — per-turn constraint capsules (本轮约束). The composer offers three
 * fixed chips the user can combine freely; the selected labels are spliced
 * into the outgoing message as a 「本轮约束：…」 hint by chatRequest (the
 * same channel length/language hints already ride), and the assistant
 * bubble of that turn echoes them back through constraintSummaryLine so
 * the user can see the constraint actually took effect.
 */

export interface ConstraintChip {
  /** Stable id — the chip's key and aria hook. */
  id: string;
  /** Chip label — injected verbatim into the 「本轮约束」 hint. */
  label: string;
  /**
   * Short form rendered by the assistant bubble's 「已按约束」 line —
   * the chip's first-person wording (我不想主动) becomes a neutral
   * constraint summary (不想主动).
   */
  summary: string;
}

/** The three composer capsules, in display order. */
export const CONSTRAINT_CHIPS: readonly ConstraintChip[] = [
  { id: 'no-initiative', label: '我不想主动', summary: '不想主动' },
  { id: 'text-only', label: '只能发短信', summary: '只能发短信' },
  { id: 'low-budget', label: '预算有限', summary: '预算有限' },
];

export const CONSTRAINT_HINT_PREFIX = '本轮约束：';
export const CONSTRAINT_SUMMARY_PREFIX = '已按约束：';

/**
 * The hint spliced into the outgoing `message` — `''` when nothing is
 * selected so the request body stays byte-identical to today.
 */
export function constraintHintText(labels: readonly string[]): string {
  const picked = labels.filter((l) => l.trim() !== '');
  return picked.length === 0
    ? ''
    : `${CONSTRAINT_HINT_PREFIX}${picked.join('、')}`;
}

/**
 * The dim line atop the assistant bubble — `''` when the turn carried no
 * constraint. Stored metadata keeps chip labels; the line renders their
 * summary forms joined by 「、」.
 */
export function constraintSummaryLine(labels: readonly string[]): string {
  const summaries = labels
    .map(
      (label) =>
        CONSTRAINT_CHIPS.find((chip) => chip.label === label)?.summary ??
        label.replace(/^我/, ''),
    )
    .filter((s) => s.trim() !== '');
  return summaries.length === 0
    ? ''
    : `${CONSTRAINT_SUMMARY_PREFIX}${summaries.join('、')}`;
}
