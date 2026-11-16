/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InputBar, {
  BUSY_ENTER_HINT_MS,
  BUSY_ENTER_HINT_TEXT,
  createBusyEnterHint,
  runComposerEnter,
} from '../src/components/InputBar';

/**
 * P203 — Enter pressed while a reply is still streaming was silently
 * swallowed: the send button is replaced by 「停止生成」, the keydown
 * returned without sending, and the typed text just sat there. The same
 * Enter now flashes a dim hint under the composer (~2 s, auto-hide)
 * instead of sending, and the composer stays editable while streaming so
 * the next message can be drafted.
 *
 * Vitest runs in node: markup assertions go through renderToStaticMarkup,
 * the keystroke path is exercised through the real `runComposerEnter` the
 * component delegates to, and the auto-hide contract through the real
 * `createBusyEnterHint` controller under fake timers.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const noop = () => {};
const enterEvent = (extra: Record<string, unknown> = {}) => ({
  key: 'Enter',
  preventDefault: vi.fn(),
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('P203 · Enter while a reply is streaming', () => {
  it('(a) streaming Enter does not call onSend — the hint becomes present', () => {
    const onSend = vi.fn();
    const hint = createBusyEnterHint(noop);
    const ev = enterEvent();

    runComposerEnter(ev, true, {
      submit: () => onSend('打好的下一句'),
      flashBusyHint: hint.flash,
    });

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(hint.visible()).toBe(true);
    expect(BUSY_ENTER_HINT_TEXT).toBe('回复生成中，完成后可发送');
  });

  it('(b) the hint auto-hides after ~2 s, and clears when streaming ends', () => {
    vi.useFakeTimers();
    const hint = createBusyEnterHint(noop);
    runComposerEnter(enterEvent(), true, {
      submit: noop,
      flashBusyHint: hint.flash,
    });
    expect(hint.visible()).toBe(true);

    vi.advanceTimersByTime(BUSY_ENTER_HINT_MS - 1);
    expect(hint.visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hint.visible()).toBe(false);

    // A second flash followed by clear() (streaming end / unmount) hides
    // immediately and cancels the pending auto-hide for good.
    runComposerEnter(enterEvent(), true, {
      submit: noop,
      flashBusyHint: hint.flash,
    });
    expect(hint.visible()).toBe(true);
    hint.clear();
    expect(hint.visible()).toBe(false);
    vi.advanceTimersByTime(10 * BUSY_ENTER_HINT_MS);
    expect(hint.visible()).toBe(false);
  });

  it('(c) with streaming false, Enter still sends exactly once with the typed text', () => {
    const sent: string[] = [];
    const hint = createBusyEnterHint(noop);

    const ev = enterEvent();
    runComposerEnter(ev, false, {
      submit: () => sent.push('她问周末干嘛，怎么回'),
      flashBusyHint: hint.flash,
    });

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(['她问周末干嘛，怎么回']);
    expect(hint.visible()).toBe(false);
  });

  it('(d) Shift+Enter while streaming neither sends nor shows the hint', () => {
    const onSend = vi.fn();
    const hint = createBusyEnterHint(noop);
    const ev = enterEvent({ shiftKey: true });

    runComposerEnter(ev, true, {
      submit: onSend,
      flashBusyHint: hint.flash,
    });

    // The key is left to the textarea: default not prevented → newline.
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(hint.visible()).toBe(false);
  });

  it('a composing Enter while streaming is left to the IME entirely', () => {
    const onSend = vi.fn();
    const hint = createBusyEnterHint(noop);
    const ev = enterEvent({ nativeEvent: { isComposing: true } });

    runComposerEnter(ev, true, {
      submit: onSend,
      flashBusyHint: hint.flash,
    });

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(hint.visible()).toBe(false);
  });

  describe('rendered markup (renderToStaticMarkup)', () => {
    it('keeps the textarea editable while streaming, stop button intact', () => {
      const markup = renderToStaticMarkup(
        createElement(InputBar, { onSend: noop, streaming: true, onStop: noop }),
      );
      const taStart = markup.indexOf('<textarea');
      const taTag = markup.slice(taStart, markup.indexOf('>', taStart));
      expect(taTag).not.toContain(' disabled');
      expect(taTag).toContain('aria-disabled="false"');
      expect(markup).toContain('aria-label="停止生成"');
      // Reserved hint row exists, empty while idle.
      expect(markup).toContain('class="busy-enter-hint"');
      expect(markup).not.toContain(BUSY_ENTER_HINT_TEXT);
    });

    it('still disables the textarea when disabled and not streaming', () => {
      const markup = renderToStaticMarkup(
        createElement(InputBar, { onSend: noop, disabled: true }),
      );
      const taStart = markup.indexOf('<textarea');
      const taTag = markup.slice(taStart, markup.indexOf('>', taStart));
      expect(taTag).toContain('disabled=""');
      expect(taTag).toContain('aria-disabled="true"');
    });
  });

  describe('source guards', () => {
    const bar = read('components/InputBar.tsx');

    it('routes the composer Enter through runComposerEnter with streaming', () => {
      expect(bar).toContain('runComposerEnter(e, streaming');
      // Inside runComposerEnter: real-Enter guard → flash or submit.
      const guardIdx = bar.indexOf('if (!shouldSubmitOnEnter(e)) return;');
      const flashIdx = bar.indexOf('actions.flashBusyHint();');
      const submitIdx = bar.indexOf('actions.submit();');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(flashIdx).toBeGreaterThan(guardIdx);
      expect(submitIdx).toBeGreaterThan(flashIdx);
      // The hint branch returns without reaching the submit path.
      const streamBranch = bar.slice(
        bar.indexOf('if (streaming)'),
        flashIdx,
      );
      expect(streamBranch).not.toContain('submit');
    });

    it('keeps mid-stream drafts across the fresh-chat session-id swap', () => {
      // 'default' → <assigned uuid> at stream end must not wipe a draft the
      // user typed while the reply was streaming.
      expect(bar).toContain('prevDraftId === DEFAULT_DRAFT_ID');
      const swapBlock = bar.slice(
        bar.indexOf('const prevDraftId'),
        bar.indexOf('// Persist the in-progress draft'),
      );
      expect(swapBlock.indexOf('DEFAULT_DRAFT_ID')).toBeLessThan(
        swapBlock.indexOf('setText(incoming)'),
      );
    });

    it('renders the hint line as a live region bound to hint visibility', () => {
      expect(bar).toContain('className="busy-enter-hint"');
      expect(bar).toContain('role="status"');
      expect(bar).toContain('busyHintVisible ? BUSY_ENTER_HINT_TEXT');
      // Timer cleared on unmount and when streaming ends.
      expect(bar).toContain('busyHint.clear()');
    });

    it('reserves the hint row height in CSS so show/hide causes no shift', () => {
      const css = read('components/InputBar.css');
      const rule = css.slice(css.indexOf('.busy-enter-hint'));
      expect(rule).toContain('height: 18px');
      expect(rule).toContain('flex-basis: 100%');
      expect(css.slice(0, css.indexOf('.busy-enter-hint'))).toContain(
        'flex-wrap: wrap',
      );
    });
  });
});
