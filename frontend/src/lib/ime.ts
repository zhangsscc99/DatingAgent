/**
 * P167 — IME composition guards. A keydown fired while an input method
 * editor (pinyin, etc.) is still composing belongs to the IME — submitting
 * on it sends half-typed candidates as a message, and Escape/Enter handlers
 * must not commit or cancel mid-conversion.
 */

/**
 * Minimal structural shape satisfied by React's synthetic KeyboardEvent, the
 * DOM KeyboardEvent, and plain test doubles — `nativeEvent` only exists on
 * the synthetic wrapper, and `keyCode === 229` is the legacy marker some
 * browsers still report while composing instead of `isComposing`.
 */
export interface KeyEventLike {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
}

/** Legacy "processed by IME" key code (IE/some Android keyboards). */
const IME_PROCESS_KEYCODE = 229;

/** True while the keystroke is part of an unfinished IME composition. */
export function isImeComposing(event: KeyEventLike): boolean {
  return (
    event.nativeEvent?.isComposing === true ||
    event.isComposing === true ||
    event.keyCode === IME_PROCESS_KEYCODE
  );
}

/** Enter submits only on a real, unshifted, non-composing keydown. */
export function shouldSubmitOnEnter(event: KeyEventLike): boolean {
  return event.key === 'Enter' && !event.shiftKey && !isImeComposing(event);
}

/** Escape acts only outside a composition — inside, the IME needs it. */
export function shouldHandleEscape(event: KeyEventLike): boolean {
  return event.key === 'Escape' && !isImeComposing(event);
}
