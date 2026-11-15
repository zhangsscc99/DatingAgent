/**
 * P136 — Escape dismissal, Tab containment and focus restoration for a
 * modal overlay. Pure DOM (no React) so the contract is testable in node:
 *
 *   - Escape runs the first available dismissal path: `onClose` (edit mode,
 *     discards edits) before `onSkip` (first-visit onboarding, the same path
 *     the 稍后再说 button uses). With neither defined it is a strict no-op —
 *     it never throws and never saves.
 *   - Tab / Shift+Tab wrap between the first and last focusable element
 *     inside the panel instead of leaking to the page behind the overlay.
 *   - `stop()` refocuses the captured `opener` — but only when the panel is
 *     gone (a re-attached effect while still open must not steal focus) and
 *     the opener is still mounted. `document.body` is never "restored":
 *     first-visit onboarding had no trigger to return to.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface DialogDismissOptions {
  /** Edit-mode dismissal (discard, do not save). Wins over onSkip. */
  onClose?: () => void;
  /** Onboarding dismissal — must be the same path the skip button uses. */
  onSkip?: () => void;
  /** Panel whose descendants trap Tab; may return null once unmounted. */
  getPanel?: () => Element | null;
  /** Element that held focus when the dialog opened. */
  opener?: Element | null;
}

export interface DialogDismissHandle {
  stop: () => void;
}

export function startDialogDismiss(options: DialogDismissOptions): DialogDismissHandle {
  const doc = document;
  const { onClose, onSkip, getPanel, opener } = options;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const dismiss = onClose ?? onSkip;
      if (!dismiss) return;
      e.preventDefault();
      dismiss();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = getPanel?.();
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc.activeElement;
    const outside = !active || !panel.contains(active);
    if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    }
  };

  doc.addEventListener('keydown', onKeyDown);

  return {
    stop() {
      doc.removeEventListener('keydown', onKeyDown);
      const panel = getPanel?.() ?? null;
      // A dep-change re-attach while still open keeps the mounted panel —
      // restoring focus there would yank it out of the dialog mid-edit.
      if (panel && doc.contains(panel)) return;
      if (
        opener &&
        opener !== doc.body &&
        typeof (opener as HTMLElement).focus === 'function' &&
        doc.contains(opener)
      ) {
        (opener as HTMLElement).focus();
      }
    },
  };
}
