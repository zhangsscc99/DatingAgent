/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import { toggleReplyVersion } from '../src/lib/replyVersions';
import type { ChatMessage } from '../src/types';

/**
 * P332 — 「换一个」 could be clicked endlessly with zero indication of which
 * generation was on screen. The action row now carries a read-only 「第 N 版」
 * label where N is the displayed reply's 1-based generation count: the first
 * version renders nothing, each regen bumps it, and the P276 version swap
 * carries the index through the parked snapshot so the badge always names
 * the text actually on screen. Pure frontend, in-memory only.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appSrc = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const css = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

const V1 = '第一版回复：先接住情绪，再给一句开场。';
const V2 = '第二版回复：顺着她提到的展览接话。';
const V3 = '第三版回复：把邀约说成共同计划。';

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: V1,
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

describe('P332 · 「第 N 版」 version badge on regenerated replies', () => {
  it('the first version renders no version badge', () => {
    const html = render(assistant());
    expect(html).not.toContain('version-badge');
    expect(html).not.toContain('第 1 版');
  });

  it('after one 换一个 the badge reads 第 2 版', () => {
    const html = render(
      assistant({
        content: V2,
        versionIndex: 2,
        previousVersion: { content: V1, versionIndex: 1 },
      }),
    );
    expect(html).toContain('version-badge');
    expect(html).toContain('第 2 版');
  });

  it('after another 换一个 the badge reads 第 3 版', () => {
    const html = render(
      assistant({
        content: V3,
        versionIndex: 3,
        previousVersion: { content: V2, versionIndex: 2 },
      }),
    );
    expect(html).toContain('第 3 版');
    expect(html).not.toContain('第 2 版');
  });

  it('回切上一版 swaps the badge to match the displayed version', () => {
    const [bubble] = toggleReplyVersion(
      [
        assistant({
          content: V3,
          versionIndex: 3,
          previousVersion: { content: V2, versionIndex: 2 },
        }),
      ],
      'a-1',
    ).slice(-1);
    expect(bubble.content).toBe(V2);
    expect(bubble.versionIndex).toBe(2);
    const html = render(bubble);
    expect(html).toContain(V2);
    expect(html).toContain('第 2 版');
    expect(html).not.toContain('第 3 版');

    // Toggling back to the newest restores its own index.
    const [back] = toggleReplyVersion([bubble], 'a-1');
    expect(back.content).toBe(V3);
    expect(back.versionIndex).toBe(3);
    expect(render(back)).toContain('第 3 版');
  });

  it('switching all the way back to version 1 hides the badge again', () => {
    const [bubble] = toggleReplyVersion(
      [
        assistant({
          content: V2,
          versionIndex: 2,
          previousVersion: { content: V1, versionIndex: 1 },
        }),
      ],
      'a-1',
    );
    expect(bubble.content).toBe(V1);
    expect(bubble.versionIndex).toBe(1);
    expect(render(bubble)).not.toContain('version-badge');
  });

  it('user bubbles never carry the badge', () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: { id: 'u-1', role: 'user', content: '你好', versionIndex: 3 },
      }),
    );
    expect(html).not.toContain('version-badge');
  });
});

describe('P332 · wiring guards', () => {
  it('the regen patch bumps the index while failure/duplicate paths restore it', () => {
    expect(appSrc).toContain('versionIndex: (target.versionIndex ?? 1) + 1');
    // Both the error restore and the P284 duplicate restore put the
    // displayed version's index back — the badge never claims a version
    // whose text isn't on screen.
    expect(appSrc.match(/versionIndex: original\.versionIndex/g)?.length).toBe(2);
  });

  it('the badge is a subdued text label, not a pill', () => {
    const start = css.indexOf('.version-badge {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('color: var(--text-secondary)');
    expect(block).toContain('font-size: 11px');
    expect(block).not.toContain('border');
    expect(block).not.toContain('cursor');
  });
});
