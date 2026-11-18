/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import InputBar, { runComposerEnter } from '../src/components/InputBar';
import { queueHintText } from '../src/lib/sendQueue';

/**
 * P203 → P244 — Enter pressed while a reply is streaming is no longer a
 * silent no-op (P203 flashed a hint and dropped the send; P244 turns the
 * same keystroke into a queued draft that auto-sends when the turn ends).
 * The composer stays editable while streaming, the queue hint counts the
 * parked drafts, and 「取消排队」 hands queued drafts back. P310 keeps
 * the row silent while nothing is queued — a global "reply generating"
 * line under the user's own bubble read like the send never happened.
 * Shift+Enter and IME-composing Enters still belong to the textarea.
 *
 * Vitest runs in node: markup assertions go through renderToStaticMarkup
 * and the keystroke path is exercised through the real `runComposerEnter`
 * the component delegates to.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const noop = () => {};
const enterEvent = (extra: Record<string, unknown> = {}) => ({
  key: 'Enter',
  preventDefault: vi.fn(),
  ...extra,
});

describe('P244 · Enter while a reply is streaming queues the draft', () => {
  it('(a) a real Enter always submits — while streaming it lands in the queue', () => {
    const submit = vi.fn();
    const ev = enterEvent();

    runComposerEnter(ev, submit);

    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('(b) Shift+Enter is left to the textarea (newline), not submitted', () => {
    const submit = vi.fn();
    const ev = enterEvent({ shiftKey: true });

    runComposerEnter(ev, submit);

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('(c) a composing Enter is left to the IME entirely', () => {
    const submit = vi.fn();
    const ev = enterEvent({ nativeEvent: { isComposing: true } });

    runComposerEnter(ev, submit);

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  describe('rendered markup (renderToStaticMarkup)', () => {
    it('keeps the textarea editable while streaming and leaves the hint row empty', () => {
      const markup = renderToStaticMarkup(
        createElement(InputBar, { onSend: noop, streaming: true, onStop: noop }),
      );
      const taStart = markup.indexOf('<textarea');
      const taTag = markup.slice(taStart, markup.indexOf('>', taStart));
      expect(taTag).not.toContain(' disabled');
      expect(taTag).toContain('aria-disabled="false"');
      expect(markup).toContain('aria-label="停止生成"');
      // P310: with an empty queue the reserved row renders no copy at
      // all — nothing that reads like the send is still waiting.
      expect(markup).toContain('class="busy-enter-hint"');
      expect(markup).not.toContain('已排队');
      expect(markup).not.toContain('自动发送');
      expect(markup).not.toContain('取消排队');
    });

    it('counts the waiting drafts and offers 取消排队 once anything is queued', () => {
      const markup = renderToStaticMarkup(
        createElement(InputBar, {
          onSend: noop,
          streaming: true,
          onStop: noop,
          queuedCount: 2,
          onCancelQueue: () => ['a', 'b'],
        }),
      );
      expect(markup).toContain('已排队 2 条');
      expect(markup).not.toContain('自动发送');
      expect(markup).toContain('queue-cancel-btn');
      expect(markup).toContain('取消排队');
    });

    it('leaves the hint row empty when idle (not streaming)', () => {
      const markup = renderToStaticMarkup(
        createElement(InputBar, { onSend: noop }),
      );
      expect(markup).toContain('class="busy-enter-hint"');
      expect(markup).not.toContain('已排队');
      expect(markup).not.toContain('取消排队');
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

    it('routes the composer Enter through runComposerEnter → submit', () => {
      expect(bar).toContain('runComposerEnter(e, submit)');
      // Inside runComposerEnter: real-Enter guard → preventDefault → submit.
      const guardIdx = bar.indexOf('if (!shouldSubmitOnEnter(e)) return;');
      const submitIdx = bar.indexOf('submit();', guardIdx);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(submitIdx).toBeGreaterThan(guardIdx);
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

    it('renders the hint line as a live region bound to the queue copy', () => {
      expect(bar).toContain('className="busy-enter-hint"');
      expect(bar).toContain('role="status"');
      expect(bar).toContain('aria-live="polite"');
      // P310: the copy only exists behind a real queue — streaming alone
      // with queuedCount === 0 renders no text node.
      expect(bar).toContain('queuedCount > 0 && queueHintText(queuedCount)');
      expect(bar).toContain('queue-cancel-btn');
      expect(bar).not.toContain('BUSY_ENTER_HINT');
      expect(queueHintText(0)).toBe('');
    });

    it('reserves the hint row height in CSS so show/hide causes no shift', () => {
      const css = read('components/InputBar.css');
      const rule = css.slice(css.indexOf('.busy-enter-hint'));
      expect(rule).toContain('height: 18px');
      expect(rule).toContain('flex-basis: 100%');
      expect(css.slice(0, css.indexOf('.busy-enter-hint'))).toContain(
        'flex-wrap: wrap',
      );
      // The 取消排队 button must stay clickable inside the click-through row.
      expect(css).toContain('.queue-cancel-btn');
      expect(css.slice(css.indexOf('.queue-cancel-btn'))).toContain(
        'pointer-events: auto',
      );
    });
  });
});
