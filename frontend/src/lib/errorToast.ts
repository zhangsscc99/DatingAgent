/** P17: how long the chat error toast stays up before dismissing itself. */
export const ERROR_TOAST_MS = 8000;

/** One visible toast; `seq` bumps on every show() so a new failure resets the window. */
export interface ErrorToastState {
  seq: number;
  text: string;
}

export interface ErrorToastController {
  /** Show (or replace) the toast and restart the auto-dismiss window. */
  show(text: string): void;
  /** Manual close — cancels the pending timer so nothing fires later. */
  dismiss(): void;
  /** Unmount-safe teardown: cancels the timer without notifying React. */
  destroy(): void;
  current(): ErrorToastState | null;
}

/**
 * P17 — single-slot error toast lifecycle. Chat failures used to leave
 * persistent banners that stacked up; now one floating toast shows the latest
 * failure, replaces itself on a new one, and hides after ERROR_TOAST_MS.
 * Framework-free so the timing contract is unit-testable with fake timers.
 */
export function createErrorToast(
  onChange: (toast: ErrorToastState | null) => void,
): ErrorToastController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: ErrorToastState | null = null;
  let seq = 0;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (next: ErrorToastState | null) => {
    current = next;
    onChange(next);
  };

  return {
    show(text: string) {
      clearTimer();
      seq += 1;
      emit({ seq, text });
      timer = setTimeout(() => {
        timer = null;
        emit(null);
      }, ERROR_TOAST_MS);
    },
    dismiss() {
      clearTimer();
      if (current) emit(null);
    },
    destroy() {
      clearTimer();
      current = null;
    },
    current: () => current,
  };
}
