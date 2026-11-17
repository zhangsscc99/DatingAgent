import type { ChatStorageState } from './chatStorage';

/** P247: how long the 清空全部 undo toast stays armed. */
export const CLEAR_ALL_UNDO_MS = 6000;
export const CLEAR_ALL_UNDO_MESSAGE = '已清空全部对话';
export const CLEAR_ALL_UNDO_ACTION_LABEL = '撤销';

/** One visible undo toast; `seq` bumps on every confirm() so a second
 * clear-all restarts the window instead of stacking two toasts. */
export interface ClearAllUndoToastState {
  seq: number;
  message: string;
  actionLabel: string;
}

/** The three storage moves a confirmed 清空全部 performs. Injected so this
 * module stays free of DOM and localStorage — unit tests drive it with
 * stubs (and fake timers for the window). */
export interface ClearAllUndoOps {
  /** Read the exact state about to be wiped — called before wipe(). */
  takeSnapshot(): ChatStorageState;
  /** Perform the actual clear (storage + chat-surface reset). */
  wipe(): void;
  /** Write the snapshot back verbatim — the undo path. */
  restore(snapshot: ChatStorageState): void;
  /** P265: optional toast copy — defaults keep the 清空全部 wording so
   * other destructive actions (the single-row delete) can reuse the same
   * single-slot undo window with their own message. */
  message?: string;
  actionLabel?: string;
}

export interface ClearAllUndoController {
  /** Confirm-and-clear: snapshot → wipe → arm the undo window and show the
   * toast. A second call disarms the pending one first — never a stacked
   * timer or a stale first snapshot that could double-restore. */
  confirm(ops: ClearAllUndoOps): void;
  /** Restore the snapshot while the window is open; a no-op once it has
   * expired, been dismissed, or already fired. */
  undo(): void;
  /** Manual close — drops the snapshot too; a closed toast never
   * resurrects data later. */
  dismiss(): void;
  /** Unmount-safe teardown: cancels the timer without notifying React. */
  destroy(): void;
  current(): ClearAllUndoToastState | null;
}

/**
 * P247 — undo window for 清空全部. The wipe used to be silent and final:
 * no toast, no way back from a stray confirm. Now the cleared state is
 * kept as an in-memory snapshot for CLEAR_ALL_UNDO_MS; 撤销 writes it back
 * verbatim and only the timeout (or a manual close) drops it for good.
 * Follows the single-slot pattern of errorToast.ts.
 */
export function createClearAllUndo(
  onChange: (toast: ClearAllUndoToastState | null) => void,
): ClearAllUndoController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: {
    snapshot: ChatStorageState;
    restore: (snapshot: ChatStorageState) => void;
  } | null = null;
  let current: ClearAllUndoToastState | null = null;
  let seq = 0;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (next: ClearAllUndoToastState | null) => {
    current = next;
    onChange(next);
  };

  /** Close the window for good — drop the armed snapshot and its timer. */
  const disarm = () => {
    clearTimer();
    pending = null;
  };

  return {
    confirm(ops) {
      disarm();
      const snapshot = ops.takeSnapshot();
      pending = { snapshot, restore: ops.restore };
      ops.wipe();
      seq += 1;
      emit({
        seq,
        message: ops.message ?? CLEAR_ALL_UNDO_MESSAGE,
        actionLabel: ops.actionLabel ?? CLEAR_ALL_UNDO_ACTION_LABEL,
      });
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        emit(null);
      }, CLEAR_ALL_UNDO_MS);
    },
    undo() {
      // Expired, dismissed, already used, or never armed — nothing to do.
      if (!pending) return;
      const { snapshot, restore } = pending;
      disarm();
      emit(null);
      restore(snapshot);
    },
    dismiss() {
      disarm();
      if (current) emit(null);
    },
    destroy() {
      disarm();
      current = null;
    },
    current: () => current,
  };
}
