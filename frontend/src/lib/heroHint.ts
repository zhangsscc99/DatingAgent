/**
 * P350 — the welcome hero hint promised 「回车发送」 on every device, but a
 * touch phone has no Enter key: the only send affordance there is the
 * paper-plane key beside the composer. Both variants live here so the
 * component can never hard-code one of them in a second place.
 */
export const HERO_HINT_KEYBOARD = '在下方输入框写下你的情况，回车发送即可开始。';
export const HERO_HINT_TOUCH = '在下方输入框写下你的情况，点发送即可开始。';

/** Coarse pointer = touch-first device (phone/tablet), regardless of width. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

export interface HeroHintEnv {
  /** `matchMedia('(pointer: coarse)')` — touch-first device. */
  coarsePointer: boolean;
  /** The existing ≤768px breakpoint used for the compact welcome layout. */
  narrowViewport: boolean;
}

/**
 * Touch copy whenever the pointer is coarse or the layout is the narrow one;
 * otherwise the keyboard copy, byte-identical to the pre-P350 string.
 */
export function heroHint(env: HeroHintEnv): string {
  return env.coarsePointer || env.narrowViewport
    ? HERO_HINT_TOUCH
    : HERO_HINT_KEYBOARD;
}
