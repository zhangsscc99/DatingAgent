/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createErrorToast,
  ERROR_TOAST_MS,
  type ErrorToastState,
} from '../src/lib/errorToast';

/**
 * P17 — chat errors surface as a single self-dismissing toast instead of
 * banners that stack up. The lifecycle logic lives in lib/errorToast.ts so
 * the timing contract is testable with fake timers; the last block keeps
 * source-level guards on the component/App wiring (same approach as the
 * other frontend tests — there is no DOM harness in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

function makeToast() {
  const onChange = vi.fn<(t: ErrorToastState | null) => void>();
  const ctl = createErrorToast(onChange);
  return { onChange, ctl };
}

describe('P17 · error toast lifecycle', () => {
  it('is an 8 second window', () => {
    expect(ERROR_TOAST_MS).toBe(8000);
  });

  it('shows the latest failure text', () => {
    vi.useFakeTimers();
    const { onChange, ctl } = makeToast();
    ctl.show('请求失败：HTTP 500');
    expect(ctl.current()).toEqual({ seq: 1, text: '请求失败：HTTP 500' });
    expect(onChange).toHaveBeenLastCalledWith({ seq: 1, text: '请求失败：HTTP 500' });
  });

  it('auto-dismisses after the window, not before', () => {
    vi.useFakeTimers();
    const { onChange, ctl } = makeToast();
    ctl.show('出错了：boom');
    vi.advanceTimersByTime(ERROR_TOAST_MS - 1);
    expect(ctl.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(ctl.current()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('resets the window when a new failure arrives', () => {
    vi.useFakeTimers();
    const { ctl } = makeToast();
    ctl.show('first');
    vi.advanceTimersByTime(ERROR_TOAST_MS - 1000);
    ctl.show('second');
    expect(ctl.current()?.seq).toBe(2);
    // Still up 7 s after the second failure — the first timer must be dead.
    vi.advanceTimersByTime(ERROR_TOAST_MS - 1000);
    expect(ctl.current()).toEqual({ seq: 2, text: 'second' });
    vi.advanceTimersByTime(1000);
    expect(ctl.current()).toBeNull();
  });

  it('cancels the timer on manual close — no orphaned callback', () => {
    vi.useFakeTimers();
    const { onChange, ctl } = makeToast();
    ctl.show('请求过于频繁');
    ctl.dismiss();
    expect(ctl.current()).toBeNull();
    vi.advanceTimersByTime(ERROR_TOAST_MS * 3);
    // Exactly two notifications: show + manual close.
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('clears the pending timer on destroy without notifying (unmount-safe)', () => {
    vi.useFakeTimers();
    const { onChange, ctl } = makeToast();
    ctl.show('network down');
    ctl.destroy();
    vi.advanceTimersByTime(ERROR_TOAST_MS * 3);
    expect(onChange).toHaveBeenCalledTimes(1); // only the show()
  });

  it('dismiss on an empty slot is a no-op', () => {
    vi.useFakeTimers();
    const { onChange, ctl } = makeToast();
    ctl.dismiss();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('P17 · toast wiring', () => {
  it('renders role="alert" with a labelled close button and a retry path', () => {
    const toast = read('components/ErrorToast.tsx');
    expect(toast).toContain('role="alert"');
    expect(toast).toContain('aria-label="关闭"');
    expect(toast).toContain('重试');
  });

  it('drives the toast only for failures with no bubble surface', () => {
    const app = read('App.tsx');
    expect(app).toContain('createErrorToast(setErrorToast)');
    // P397: a failure that already owns an error bubble keeps the in-bubble
    // 重试 as the single recovery affordance — the toast shows only when
    // the outcome did not surface in a bubble.
    expect(app).toContain('outcome.surfacedInBubble');
    expect(app).toContain('toastCtl.show(outcome.errorText)');
    // Timer teardown on unmount.
    expect(app).toContain('toastCtl.destroy()');
    // Retry still funnels through the shared last-failure path.
    expect(app).toContain('handleServiceRetry()');
  });

  it('overlays the toast inside the chat area without layout shift', () => {
    const win = read('components/ChatWindow.tsx');
    expect(win).toContain('<ErrorToast');
    const css = read('components/ErrorToast.css');
    expect(css).toContain('position: absolute');
  });
});
