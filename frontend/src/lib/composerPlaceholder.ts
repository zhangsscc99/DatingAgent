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
 * P241 — the same clip continues past 599 px: at 600–695 px the composer
 * tool row still squeezes the textarea under the placeholder's one-line
 * width (measured scrollHeight 72 vs clientHeight 48), and at 769–955 px
 * the persistent 260 px sidebar squeezes it to ~250–425 px so the long
 * hint wraps to two lines again (66 vs 45). Both bands reuse the 88 px
 * min-height; 696–768 px and ≥956 px fit the placeholder on one line.
 */

/** Upper edge of the 600–695 px continuation band. */
export const MIDWIDTH2_COMPOSER_MAX_WIDTH = 695;

/** Media query matching the 600–695 px band — kept in sync with the px constants. */
export const MIDWIDTH2_COMPOSER_QUERY = `(min-width: ${
  MIDWIDTH_COMPOSER_MAX_WIDTH + 1
}px) and (max-width: ${MIDWIDTH2_COMPOSER_MAX_WIDTH}px)`;

/** Upper edge of the 769–955 px sidebar-squeeze band. */
export const SIDEBAR_WRAP_COMPOSER_MAX_WIDTH = 955;

/** Media query matching the sidebar-squeeze band — kept in sync with the px constants. */
export const SIDEBAR_WRAP_COMPOSER_QUERY = `(min-width: 769px) and (max-width: ${SIDEBAR_WRAP_COMPOSER_MAX_WIDTH}px)`;

/**
 * Composer min-height (px) for a viewport width — mirrors the CSS rules:
 * 88 px wherever the full placeholder wraps (431–695 px and 769–955 px),
 * 48 px elsewhere at ≤768 px, 44 px on desktop.
 */
export function composerMinHeightPx(viewportWidth: number): number {
  if (viewportWidth <= MIDWIDTH2_COMPOSER_MAX_WIDTH) {
    return viewportWidth <= NARROW_COMPOSER_MAX_WIDTH
      ? 48
      : MIDWIDTH_COMPOSER_MIN_HEIGHT;
  }
  if (viewportWidth <= 768) {
    return 48;
  }
  return viewportWidth <= SIDEBAR_WRAP_COMPOSER_MAX_WIDTH
    ? MIDWIDTH_COMPOSER_MIN_HEIGHT
    : 44;
}

/** Current-viewport check; false outside a browser or without matchMedia. */
export function isNarrowComposerViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(NARROW_COMPOSER_QUERY).matches;
}
