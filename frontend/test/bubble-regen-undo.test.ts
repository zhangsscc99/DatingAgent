/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import { serializeMessages } from '../src/lib/chatStorage';
import { toggleReplyVersion, versionSnapshotOf } from '../src/lib/replyVersions';
import type { ChatMessage } from '../src/types';

/**
 * P276 — 「换一个」 overwrote the bubble in place, so a better earlier reply
 * was gone for good. The outgoing reply is now parked in a single in-memory
 * slot on the message (previousVersion while the newest text shows,
 * newerVersion while the parked older text is on screen), and a
 * 恢复上一版/查看新版 pill next to 换一个 swaps between them. The slot is
 * dropped by serializeMessages, so a refresh persists whichever version was
 * displayed. No DOM harness in this repo — the contract is pinned by pure
 * reducer tests, renderToStaticMarkup checks, and source guards.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleSrc = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const chatWindowSrc = readFileSync(join(SRC, 'components', 'ChatWindow.tsx'), 'utf8');
const appSrc = readFileSync(join(SRC, 'App.tsx'), 'utf8');

const OLD = '旧版回复：先接住情绪，再给一句能直接发出去的开场。';
const NEW = '新版回复：顺着她提到的展览，把邀约说成共同计划。';

const user = (content = '她回复很慢，我该怎么接？'): ChatMessage => ({
  id: 'u-1',
  role: 'user',
  content,
});

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: NEW,
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

describe('P276 · 换一个 parks the outgoing reply for undo', () => {
  it('versionSnapshotOf captures content plus tool/meta/stopped state', () => {
    const toolEvents = [{ name: 'coach', label: '对话建议', status: 'done' as const }];
    const meta = { tool: 'coach', latencyMs: 1200, tokens: 88 };
    const snapshot = versionSnapshotOf(
      assistant({ content: OLD, toolEvents, meta, stopped: true }),
    );
    expect(snapshot).toEqual({
      content: OLD,
      toolEvents,
      meta,
      stopped: true,
    });
  });

  it('the regen patch stashes the outgoing reply before the stream overwrites it', () => {
    // handleRegenerate must park `original` on the same patch that marks the
    // bubble regenerating — otherwise the first delta would already have
    // destroyed the text being saved.
    expect(appSrc).toContain('const original = versionSnapshotOf(target);');
    const patchAt = appSrc.indexOf('regenerating: true');
    expect(patchAt).toBeGreaterThan(-1);
    const block = appSrc.slice(patchAt, appSrc.indexOf('});', patchAt));
    expect(block).toContain('previousVersion: original');
    expect(block).toContain('newerVersion: undefined');
  });

  it('after regenerating, the bubble offers 恢复上一版 next to 换一个', () => {
    const html = render(assistant({ previousVersion: { content: OLD } }));
    expect(html).toContain('version-toggle');
    expect(html).toContain('恢复上一版');
    expect(html).toContain('aria-label="恢复上一版回复"');
    expect(html).toContain('换一个');
  });

  it('invoking the toggle puts the original reply back into the bubble', () => {
    const meta = { tool: 'coach', tokens: 50 };
    const next = toggleReplyVersion(
      [user(), assistant({ previousVersion: { content: OLD, meta } })],
      'a-1',
    );
    const bubble = next[1];
    expect(bubble.content).toBe(OLD);
    expect(bubble.meta).toEqual(meta);
    // The version just displayed parks in the opposite slot so the toggle
    // can run backwards — previousVersion is consumed by the swap.
    expect(bubble.previousVersion).toBeUndefined();
    expect(bubble.newerVersion).toEqual(
      expect.objectContaining({ content: NEW }),
    );
    const html = render(bubble);
    expect(html).toContain(OLD);
    expect(html).toContain('查看新版');
    expect(html).toContain('aria-label="查看新版回复"');
  });

  it('the toggle is two-way — 查看新版 swaps the newer reply back', () => {
    const once = toggleReplyVersion(
      [user(), assistant({ previousVersion: { content: OLD } })],
      'a-1',
    );
    const twice = toggleReplyVersion(once, 'a-1');
    expect(twice[1].content).toBe(NEW);
    expect(twice[1].previousVersion).toEqual(
      expect.objectContaining({ content: OLD }),
    );
    expect(twice[1].newerVersion).toBeUndefined();
  });

  it('regenerating again after a restore can be switched back (snapshot follows the displayed text)', () => {
    // While 旧版 is on screen, newerVersion parks 新版. The next 换一个
    // snapshots the displayed (old) text via versionSnapshotOf, so 恢复上一版
    // after that regen still lands on a real version — never a blank.
    const restored = toggleReplyVersion(
      [user(), assistant({ previousVersion: { content: OLD } })],
      'a-1',
    )[1];
    expect(restored.content).toBe(OLD);
    expect(versionSnapshotOf(restored)).toEqual(
      expect.objectContaining({ content: OLD }),
    );
    expect(restored.newerVersion).toEqual(
      expect.objectContaining({ content: NEW }),
    );
  });

  it('the control is absent before any regeneration', () => {
    const html = render(assistant());
    expect(html).not.toContain('version-toggle');
    expect(html).not.toContain('恢复上一版');
    expect(html).not.toContain('查看新版');
  });

  it('the control is hidden while a regeneration is in flight', () => {
    const html = render(
      assistant({ streaming: true, regenerating: true, previousVersion: { content: OLD } }),
    );
    expect(html).not.toContain('version-toggle');
    expect(html).not.toContain('恢复上一版');
    expect(html).toContain('正在重新生成');
  });

  it('the control stays hidden on a failure-restored error bubble', () => {
    // P26 restores the original text with error flags; the parked copy is
    // identical, so offering a swap would be dead UI.
    const html = render(
      assistant({ content: OLD, error: true, errorDetail: '出错了', previousVersion: { content: OLD } }),
    );
    expect(html).not.toContain('version-toggle');
  });

  it('the reducer is a no-op for bubbles with nothing parked or mid-flight', () => {
    const plain = assistant();
    expect(toggleReplyVersion([plain], 'a-1')[0]).toBe(plain);
    const inflight = assistant({ regenerating: true, previousVersion: { content: OLD } });
    expect(toggleReplyVersion([inflight], 'a-1')[0]).toBe(inflight);
    const other = assistant({ id: 'a-2', previousVersion: { content: OLD } });
    expect(toggleReplyVersion([other], 'a-1')[0]).toBe(other);
  });

  it('whichever version is displayed is what gets persisted — slots never reach storage', () => {
    const [, out] = serializeMessages([
      user(),
      assistant({ content: OLD, newerVersion: { content: NEW } }),
    ]);
    expect(out.content).toBe(OLD);
    expect('previousVersion' in out).toBe(false);
    expect('newerVersion' in out).toBe(false);
  });
});

describe('P276 · wiring guards', () => {
  it('the toggle pill reuses .regen-btn and fires the handler with the message id', () => {
    const btnStart = bubbleSrc.indexOf('className="regen-btn version-toggle"');
    expect(btnStart).toBeGreaterThan(-1);
    const block = bubbleSrc.slice(btnStart, bubbleSrc.indexOf('</button>', btnStart));
    expect(block).toContain('onClick={handleToggleVersion}');
    expect(block).toContain('disabled={busy}');
    expect(block).toContain('aria-label=');
    const handlerStart = bubbleSrc.indexOf('const handleToggleVersion');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = bubbleSrc.slice(handlerStart, bubbleSrc.indexOf('}, [', handlerStart));
    expect(handler).toContain('onToggleReplyVersion?.(message.id)');
  });

  it('the toggle is gated on a parked slot plus a settled bubble', () => {
    const start = bubbleSrc.indexOf('const canToggleVersion');
    expect(start).toBeGreaterThan(-1);
    const block = bubbleSrc.slice(start, bubbleSrc.indexOf(';', start));
    expect(block).toContain('!message.streaming');
    expect(block).toContain('!message.regenerating');
    expect(block).toContain('!message.error');
    expect(block).toContain('message.previousVersion !== undefined');
  });

  it('App and ChatWindow plumb the handler down to the bubble', () => {
    expect(appSrc).toContain('toggleReplyVersion(prev, messageId)');
    expect(appSrc).toContain('onToggleReplyVersion={handleToggleReplyVersion}');
    expect(chatWindowSrc).toContain('onToggleReplyVersion={onToggleReplyVersion}');
  });

  it('the actions row wraps so the third pill cannot overflow at 390px', () => {
    const css = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');
    const rowStart = css.indexOf('.bubble-actions {');
    const row = css.slice(rowStart, css.indexOf('}', rowStart));
    expect(row).toContain('flex-wrap: wrap');
    // The toggle reuses .regen-btn, which already carries the >=36px mobile
    // touch-target rule — no separate sizing block may be needed.
    expect(css).toContain('.regen-btn');
  });
});
