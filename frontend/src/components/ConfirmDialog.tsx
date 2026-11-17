import { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps {
  /** Short action name shown as the dialog heading. */
  title: string;
  /** The exact copy the native confirm dialog used to show. */
  description: string;
  /** Danger-coloured primary button — the only control that runs the action. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * P228 — the app's own confirmation layer for destructive actions, replacing
 * the browser-native confirm. Renders [role="alertdialog"]; Escape and
 * overlay clicks are treated as cancel, Tab stays trapped inside, and focus
 * returns to the trigger on close. 取消 is the default focus so a stray
 * Enter never nukes history.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  onCancelRef.current = onCancel;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    // Capture the trigger before focus moves into the dialog so close can
    // hand it back — the same contract startDialogDismiss's opener gives
    // SettingsSheet/ProfileOnboarding.
    const opener = document.activeElement;
    cancelRef.current?.focus();

    // Capture phase: the confirm dialog may sit above another sheet
    // (settings → 清空全部对话), and the topmost layer must settle
    // Escape/Tab before anything underneath hears them.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Handled or not, a Tab inside the topmost dialog never reaches the
      // sheet below — its own trap would read activeElement as "outside".
      e.stopImmediatePropagation();
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !active || !panel.contains(active);
      if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (
        opener &&
        opener !== document.body &&
        typeof (opener as HTMLElement).focus === 'function' &&
        document.contains(opener)
      ) {
        (opener as HTMLElement).focus();
      }
    };
  }, []);

  return (
    <div
      className="confirm-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancelRef.current();
      }}
    >
      <div className="confirm-panel" ref={panelRef}>
        <h2 id="confirm-dialog-title" className="confirm-title">
          {title}
        </h2>
        <p id="confirm-dialog-desc" className="confirm-desc">
          {description}
        </p>
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-btn"
            onClick={() => onCancelRef.current()}
          >
            取消
          </button>
          <button
            type="button"
            className="confirm-btn danger"
            aria-label={confirmLabel}
            onClick={() => onConfirmRef.current()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
