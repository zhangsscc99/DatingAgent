/** P132: keyboard navigation over the 最近对话 session list. Pure helper —
 * given the focused row's index, the number of rendered rows and a direction
 * (-1 = ArrowUp, +1 = ArrowDown), return the index to focus next. Clamps at
 * both ends (no wrap); an empty list or an out-of-range current index yields
 * -1 so callers can no-op. */
export function nextSessionIndex(
  current: number,
  length: number,
  direction: -1 | 1,
): number {
  if (length <= 0 || current < 0 || current >= length) return -1;
  const next = current + direction;
  if (next < 0 || next >= length) return -1;
  return next;
}

/** Direction for a key, or null when the key is not a handled arrow. */
export function sessionNavDirection(key: string): -1 | 1 | null {
  if (key === 'ArrowDown') return 1;
  if (key === 'ArrowUp') return -1;
  return null;
}
