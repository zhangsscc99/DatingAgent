/**
 * P328: while the user is reading older history, a new message or a
 * streaming delta must not drag the viewport back to the tail. ChatWindow
 * calls scrollIntoView only when this returns true — the scrollport is
 * already near the bottom, or the update carries the user's own just-sent
 * turn (sending always follows to the bottom).
 */
export const AUTO_SCROLL_BOTTOM_THRESHOLD = 120;

export function shouldAutoScroll({
  distanceFromBottom,
  isOwnTurn,
}: {
  distanceFromBottom: number;
  isOwnTurn: boolean;
}): boolean {
  if (isOwnTurn) return true;
  // Infinity/NaN mean "cannot prove at-bottom" — never chase the tail.
  if (!Number.isFinite(distanceFromBottom)) return false;
  return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}
