/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import type { ChatMessage } from '../src/types';

/**
 * P371 — 「换一个」 was the product's most frequent micro loop and the only one
 * without a generating state: three live regenerations took 3.5 / 3.3 / 6.4 s
 * and `sawIndicator` was false each time (the first send showed it), because
 * the only feedback was the button greying out and the old 11 px muted
 * 「正在重新生成…」 line that neither users nor vision picked up.
 *
 * The contract pinned here:
 *   1. within the click frame the bubble exposes a visible, machine-readable
 *      generating affordance — [aria-label="正在重新生成"] / data-testid
 *      "regen-indicator" inside the bubble body (not only a disabled button),
 *   2. the outgoing reply stays rendered until the replacement arrives (no
 *      white flash, P371's 不闪白 requirement),
 *   3. the App flags regenerating:true on the SAME patch as streaming:true and
 *      BEFORE it re-issues the stream, so the indicator is mounted on the
 *      first render after the click (the 300 ms budget the item asks for),
 *   4. the pill is styled visibly (brand-tinted, weight 600) instead of the
 *      11 px muted text that shipped before.
 *
 * vitest runs in node (no DOM renderer, no jsdom dependency), so the contract
 * is pinned with a static render plus source/CSS guards — the same convention
 * as bubble-regen-undo.test.ts and bubble-regen-no-glyph.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleSrc = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');
const appSrc = readFileSync(join(SRC, 'App.tsx'), 'utf8');

const OLD = '旧版回复：先接住她的情绪，再给一句能直接发出去的开场。';

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: OLD,
  createdAt: 2,
  ...over,
});

const render = (message: ChatMessage) =>
  renderToStaticMarkup(
    createElement(MessageBubble, {
      message,
      onRegenerate: () => {},
      onToggleReplyVersion: () => {},
    }),
  );

const cssRule = (selector: string): string => {
  const at = bubbleCss.indexOf(`${selector} {`);
  expect(at, `css rule ${selector}`).toBeGreaterThan(-1);
  return bubbleCss.slice(at, bubbleCss.indexOf('}', at));
};

describe('P371 · 「换一个」 shows a generating state instead of a dead bubble', () => {
  it('renders a visible indicator with aria-label 正在重新生成 while regenerating', () => {
    const html = render(assistant({ streaming: true, regenerating: true }));

    expect(html).toContain('data-testid="regen-indicator"');
    expect(html).toContain('aria-label="正在重新生成"');
    // Machine-readable even for detectors that only read text.
    expect(html).toContain('正在重新生成');
    // The live region must not be aria-hidden — it is the announcement.
    const indicatorAt = html.indexOf('data-testid="regen-indicator"');
    const tagStart = html.lastIndexOf('<div', indicatorAt);
    const tag = html.slice(tagStart, html.indexOf('>', indicatorAt) + 1);
    expect(tag).toContain('role="status"');
    expect(tag).not.toContain('aria-hidden="true"');
    // The dot pulse is decorative only.
    expect(html).toContain('class="regen-status-dots" aria-hidden="true"');
  });

  it('keeps the outgoing reply rendered until the replacement arrives (不闪白)', () => {
    const html = render(assistant({ streaming: true, regenerating: true }));

    expect(html).toContain('先接住她的情绪');
    // A regenerating bubble must never fall back to the empty-first-send
    // placeholder: that path is gated on !content.
    expect(html).not.toContain('streaming-indicator');
  });

  it('is gone once the stream settles, and carries the version when known', () => {
    expect(render(assistant({ streaming: false }))).not.toContain('data-testid="regen-indicator"');

    const second = render(
      assistant({ streaming: true, regenerating: true, versionIndex: 2 }),
    );
    expect(second).toContain('data-testid="regen-indicator"');
    expect(second).toContain('data-version="2"');
    expect(second).toContain('正在重新生成（第 2 版）');
  });

  it('flags regenerating on the same pre-request patch as streaming (300 ms budget)', () => {
    const start = appSrc.indexOf('const handleRegenerate');
    expect(start).toBeGreaterThan(-1);
    const body = appSrc.slice(start, start + 6000);

    const regeneratingAt = body.indexOf('regenerating: true');
    const streamingAt = body.indexOf('streaming: true');
    const streamCallAt = body.indexOf('void streamReply(');
    const releaseAt = body.indexOf('patchIfPresent({ regenerating: undefined })');

    expect(regeneratingAt, 'regenerating: true in handleRegenerate').toBeGreaterThan(-1);
    expect(streamingAt, 'streaming: true in the same patch').toBeGreaterThan(-1);
    // Same patch object, i.e. one render — never a post-response flag.
    expect(Math.abs(regeneratingAt - streamingAt)).toBeLessThan(400);
    expect(regeneratingAt).toBeLessThan(streamCallAt);
    // Cleared only after the stream settles.
    expect(releaseAt).toBeGreaterThan(streamCallAt);
  });

  it('styles the pill so it is actually visible (brand tint, weight >= 600)', () => {
    const rule = cssRule('.regen-status');
    expect(rule).toContain('background: var(--accent-soft)');
    expect(rule).toContain('color: var(--accent)');
    expect(rule).toMatch(/font-weight:\s*[6-9]00/);
    expect(rule).not.toContain('display: none');
    // The old muted 11 px line must not come back.
    expect(rule).not.toContain('--text-muted');
    expect(rule).not.toMatch(/font-size:\s*11px/);
    expect(bubbleCss).toContain('@keyframes regen-status-pulse');
  });
});
