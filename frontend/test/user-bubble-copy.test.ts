/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P184 — user bubbles had no copy affordance: `canCopy` in MessageBubble.tsx
 * started with `!isUser`, so only assistant replies could be copied even though
 * P31 promised a copy action on every chat bubble. The fix drops the role
 * check so a non-streaming, non-error, non-blank user bubble renders the same
 * copy button (same `copyText` helper, same 1.5 s feedback, same
 * `.bubble-actions` layout). These tests lock the contract at source level
 * (no DOM renderer in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleTsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');

const canCopyExpr = (() => {
  const start = bubbleTsx.indexOf('const canCopy');
  expect(start).toBeGreaterThan(-1);
  return bubbleTsx.slice(start, bubbleTsx.indexOf(';', start));
})();

describe('P184 copy button on user bubbles', () => {
  it('canCopy no longer excludes user messages', () => {
    expect(canCopyExpr).not.toContain('isUser');
  });

  it('still requires a settled, non-error, non-blank message', () => {
    // Streaming bubbles, error bubbles and empty/whitespace content keep
    // hiding the button — this applies to user and assistant bubbles alike.
    expect(canCopyExpr).toContain('!message.streaming');
    expect(canCopyExpr).toContain('!message.error');
    expect(canCopyExpr).toContain('message.content.trim().length > 0');
  });

  it('renders one copy button shared by both roles inside .bubble-actions', () => {
    const actionsStart = bubbleTsx.indexOf('className="bubble-actions"');
    expect(actionsStart).toBeGreaterThan(-1);
    const block = bubbleTsx.slice(actionsStart, bubbleTsx.indexOf('</div>', actionsStart));
    expect(block).toContain('{canCopy && (');
    expect(block).toContain('className={`copy-btn');
    expect(block).toContain('onClick={handleCopy}');
    // Same aria-label / feedback path for whichever bubble shows the button.
    expect(block).toContain("aria-label={copyState === 'copied' ? '已复制' : '复制回复'}");
    expect(block).toContain('className="copy-status"');
    expect(block).toContain('aria-live="polite"');
  });

  it('keeps the 1.5 s copied-feedback timer', () => {
    expect(bubbleTsx).toContain('const COPY_FEEDBACK_MS = 1500');
  });

  it('does not gate the actions row on the assistant role', () => {
    const actionsGuard = bubbleTsx.indexOf('{(canCopy || canRegen) && (');
    expect(actionsGuard).toBeGreaterThan(-1);
  });
});
