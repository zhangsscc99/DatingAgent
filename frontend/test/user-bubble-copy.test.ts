/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P184 — user bubbles had no copy affordance, so `canCopy` dropped its
 * `!isUser` gate and every bubble shared the copy pill.
 *
 * P304 reverses that decision: on the phone the pink user bubble carried a
 * 「复制」 that copied a sentence the user had just typed themselves —
 * useless, and the pill stretched the bubble taller. `canCopy` starts with
 * `!isUser` again, so user bubbles render no action row at all while
 * assistant bubbles keep the identical copy path (same copyText helper,
 * same 1.5 s feedback, same `.bubble-actions` layout). The role-aware
 * 「复制我的消息」 label is gone with the button — the one remaining pill is
 * always 「复制回复」. These tests lock the contract at source level (no
 * DOM renderer in this repo); the mounted-DOM side lives in
 * message-actions.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleTsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');

const canCopyExpr = (() => {
  const start = bubbleTsx.indexOf('const canCopy');
  expect(start).toBeGreaterThan(-1);
  return bubbleTsx.slice(start, bubbleTsx.indexOf(';', start));
})();

describe('P304 copy button leaves user bubbles', () => {
  it('canCopy excludes user messages again', () => {
    expect(canCopyExpr).toContain('!isUser');
  });

  it('still requires a settled, non-error, non-blank message', () => {
    // Streaming bubbles, error bubbles and empty/whitespace content keep
    // hiding the button on assistant messages too.
    expect(canCopyExpr).toContain('!message.streaming');
    expect(canCopyExpr).toContain('!message.error');
    expect(canCopyExpr).toContain('bodyText.trim().length > 0');
  });

  it('renders the single assistant copy button inside .bubble-actions', () => {
    const actionsStart = bubbleTsx.indexOf('className="bubble-actions"');
    expect(actionsStart).toBeGreaterThan(-1);
    const block = bubbleTsx.slice(actionsStart, bubbleTsx.indexOf('</div>', actionsStart));
    expect(block).toContain('{canCopy && (');
    expect(block).toContain('className={`copy-btn');
    expect(block).toContain('onClick={handleCopy}');
    // With the user bubble out of scope the label needs no role branch:
    // one accessible name, 「复制回复」.
    expect(block).not.toContain('复制我的消息');
    expect(block).toContain('className="copy-status"');
    expect(block).toContain('aria-live="polite"');
  });

  it('keeps the 1.5 s copied-feedback timer', () => {
    expect(bubbleTsx).toContain('const COPY_FEEDBACK_MS = 1500');
  });

  it('keeps the actions row guarded on copy-or-regen', () => {
    const actionsGuard = bubbleTsx.indexOf('{(canCopy || showRegenButton) && (');
    expect(actionsGuard).toBeGreaterThan(-1);
  });
});
