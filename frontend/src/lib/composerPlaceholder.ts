/**
 * P193 — at a 390 px viewport the composer's full placeholder wraps to three
 * lines inside a 50 px textarea and is clipped mid-line. Below the narrow
 * breakpoint the composer swaps to a short hint; the full copy stays as the
 * aria-label at every width so assistive tech still gets the description.
 */

/** Full hint, used on wide viewports and as the textarea's aria-label. */
export const COMPOSER_PLACEHOLDER_FULL =
  '描述你的问题，例如：对方说「在干嘛」，我该怎么回？';

/** Short hint that fits on one line at 390 px. */
export const COMPOSER_PLACEHOLDER_NARROW = '说说你的情况…';

/** Viewport width (px) at or below which the short hint is used. */
export const NARROW_COMPOSER_MAX_WIDTH = 430;

/** Media query matching the narrow breakpoint — kept in sync with the px constant. */
export const NARROW_COMPOSER_QUERY = `(max-width: ${NARROW_COMPOSER_MAX_WIDTH}px)`;

export function composerPlaceholder(viewportWidth: number): string {
  return viewportWidth <= NARROW_COMPOSER_MAX_WIDTH
    ? COMPOSER_PLACEHOLDER_NARROW
    : COMPOSER_PLACEHOLDER_FULL;
}

/** Current-viewport check; false outside a browser or without matchMedia. */
export function isNarrowComposerViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(NARROW_COMPOSER_QUERY).matches;
}
