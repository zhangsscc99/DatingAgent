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

/**
 * P195 — between 431 px and 599 px the full placeholder wraps to three
 * lines (~84 px scrollHeight) inside the 48/60 px textarea, clipping the
 * last line. The band gets a taller min-height; the send button row,
 * placeholder copy and ≤430 px short-hint behaviour stay as they are.
 */
export const MIDWIDTH_COMPOSER_MAX_WIDTH = 599;

/** Min-height (px) that fits the three-line full placeholder in the band. */
export const MIDWIDTH_COMPOSER_MIN_HEIGHT = 88;

/** Media query matching the mid-width band — kept in sync with the px constants. */
export const MIDWIDTH_COMPOSER_QUERY = `(min-width: ${
  NARROW_COMPOSER_MAX_WIDTH + 1
}px) and (max-width: ${MIDWIDTH_COMPOSER_MAX_WIDTH}px)`;

/**
 * Composer min-height (px) for a viewport width — mirrors the CSS rules:
 * 88 px in the 431–599 px band, 48 px elsewhere at ≤768 px, 44 px on desktop.
 */
export function composerMinHeightPx(viewportWidth: number): number {
  if (viewportWidth <= MIDWIDTH_COMPOSER_MAX_WIDTH) {
    return viewportWidth <= NARROW_COMPOSER_MAX_WIDTH
      ? 48
      : MIDWIDTH_COMPOSER_MIN_HEIGHT;
  }
  return viewportWidth <= 768 ? 48 : 44;
}

/** Current-viewport check; false outside a browser or without matchMedia. */
export function isNarrowComposerViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(NARROW_COMPOSER_QUERY).matches;
}
