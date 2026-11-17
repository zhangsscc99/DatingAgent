/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_PLACEHOLDER_FULL,
  COMPOSER_PLACEHOLDER_NARROW,
  NARROW_COMPOSER_MAX_WIDTH,
  NARROW_COMPOSER_QUERY,
  composerPlaceholder,
} from '../src/lib/composerPlaceholder';
import InputBar from '../src/components/InputBar';
import { FakeEvent, installFakeDom } from './helpers/fakeDom';

/**
 * P193 — at 390×844 the composer textarea measured 50 px high while the full
 * placeholder needed 96 px (3 wrapped lines), so the hint was clipped
 * mid-line. The fix swaps in a short placeholder at ≤430 px while the
 * aria-label keeps the full description at every width. These tests lock the
 * copy at the pure-function level plus source-level checks on the markup
 * (no DOM renderer in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');

describe('P193 · narrow-viewport composer placeholder', () => {
  it('uses the short placeholder at and below 430 px', () => {
    expect(composerPlaceholder(390)).toBe(COMPOSER_PLACEHOLDER_NARROW);
    expect(composerPlaceholder(NARROW_COMPOSER_MAX_WIDTH)).toBe(
      COMPOSER_PLACEHOLDER_NARROW,
    );
    expect(composerPlaceholder(320)).toBe(COMPOSER_PLACEHOLDER_NARROW);
  });

  it('keeps the full original placeholder on wide viewports', () => {
    expect(composerPlaceholder(NARROW_COMPOSER_MAX_WIDTH + 1)).toBe(
      COMPOSER_PLACEHOLDER_FULL,
    );
    expect(composerPlaceholder(1440)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(COMPOSER_PLACEHOLDER_FULL).toBe(
      '描述你的问题，例如：对方说「在干嘛」，我该怎么回？',
    );
  });

  it('the media query matches the px breakpoint constant', () => {
    expect(NARROW_COMPOSER_QUERY).toBe('(max-width: 430px)');
  });

  it('aria-label carries the full description at both widths', () => {
    // One constant feeds aria-label regardless of viewport width, so the
    // description is identical at 390 px and 1440 px.
    expect(inputBarTsx).toContain('aria-label={COMPOSER_PLACEHOLDER_FULL}');
    expect(COMPOSER_PLACEHOLDER_FULL).toContain('描述你的问题');
    const ariaLine = inputBarTsx
      .split('\n')
      .find((line) => line.includes('aria-label={COMPOSER_PLACEHOLDER_FULL}'));
    expect(ariaLine).toBeDefined();
    expect(ariaLine).not.toContain('narrowViewport');
  });

  it('the textarea placeholder branches on the narrow-viewport state', () => {
    expect(inputBarTsx).toContain('isNarrowComposerViewport');
    expect(inputBarTsx).toContain('window.matchMedia(NARROW_COMPOSER_QUERY)');
    expect(inputBarTsx).toContain(
      'narrowViewport ? COMPOSER_PLACEHOLDER_NARROW : COMPOSER_PLACEHOLDER_FULL',
    );
  });

  it('does not disturb enterKeyHint or the send behaviour', () => {
    expect(inputBarTsx).toContain('enterKeyHint="send"');
    expect(inputBarTsx).toContain('if (!shouldSubmitOnEnter(e)) return;');
  });
});

/**
 * P237 — the placeholder was chosen once at mount; a live 780→390 resize
 * left the long copy clipped (scrollHeight 96 / clientHeight 48). The fix
 * re-evaluates the media query on BOTH the mq 'change' event and a window
 * 'resize' fallback (engines/webviews that don't deliver mq change still
 * fire resize). This mounts the real InputBar against the fake DOM with a
 * controllable matchMedia — react-dom is imported lazily because its
 * canUseDOM flag is captured at module evaluation time.
 */
describe('P237 · placeholder follows width changes', () => {
  it('swaps copy on window resize even when mq change never fires', async () => {
    const dom = installFakeDom();
    let matches = false;
    const mqListeners: Array<() => void> = [];
    const win = dom.window as unknown as Record<string, unknown>;
    win.matchMedia = (query: string) => ({
      get matches() {
        return query === NARROW_COMPOSER_QUERY ? matches : false;
      },
      media: query,
      addEventListener: (_type: string, fn: () => void) => {
        mqListeners.push(fn);
      },
      removeEventListener: (_type: string, fn: () => void) => {
        const i = mqListeners.indexOf(fn);
        if (i >= 0) mqListeners.splice(i, 1);
      },
      dispatchEvent: () => false,
    });
    const g = globalThis as Record<string, unknown>;
    g.matchMedia = win.matchMedia;

    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(InputBar, { onSend: () => {} }));
    });

    const ta = dom.document.querySelector('textarea');
    expect(ta).not.toBeNull();
    // Mounted at 780 px-equivalent (query not matching): long copy.
    expect(ta!.getAttribute('placeholder')).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(mqListeners.length).toBeGreaterThan(0);

    // 780 → 390: the query now matches but the engine delivers only the
    // 'resize' signal — the copy must still flip (the P237 defect path).
    matches = true;
    await act(async () => {
      dom.window.dispatchEvent(new FakeEvent('resize'));
    });
    expect(ta!.getAttribute('placeholder')).toBe(COMPOSER_PLACEHOLDER_NARROW);

    // 390 → 1440 via the mq 'change' path restores the long copy.
    matches = false;
    await act(async () => {
      for (const fn of [...mqListeners]) fn();
    });
    expect(ta!.getAttribute('placeholder')).toBe(COMPOSER_PLACEHOLDER_FULL);

    // Unmount removes both subscriptions — a late resize must not set state.
    await act(async () => {
      root.unmount();
    });
    expect(mqListeners.length).toBe(0);
    const winListeners = (dom.window as unknown as { _listeners: Map<string, unknown[]> })
      ._listeners;
    expect(winListeners.get('resize')?.length ?? 0).toBe(0);
  });

  it('the source wires both the mq change listener and the resize fallback', () => {
    expect(inputBarTsx).toContain("mq.addEventListener('change', onChange)");
    expect(inputBarTsx).toContain("window.addEventListener('resize', onChange)");
    expect(inputBarTsx).toContain("window.removeEventListener('resize', onChange)");
    expect(inputBarTsx).toContain('setNarrowViewport(mq.matches)');
  });
});
