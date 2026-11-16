/**
 * P133 — whether the user has interacted with the app in this page session.
 * The composer's mount autofocus (P105) is gated on this so a cold load leaves
 * focus at the document start and the first Tab reaches the skip link, while
 * remounts inside an already-used session keep autofocusing as before.
 * Module-level state: resets on full page load, survives session switches.
 */

let interacted = false;

export function markInteraction(): void {
  interacted = true;
}

export function hasInteracted(): boolean {
  return interacted;
}

let tracking = false;

export function startInteractionTracking(): void {
  if (tracking) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  tracking = true;
  const mark = () => markInteraction();
  window.addEventListener('pointerdown', mark, { capture: true, passive: true, once: true });
  window.addEventListener('keydown', mark, { capture: true, once: true });
}
