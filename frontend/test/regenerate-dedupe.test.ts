/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import {
  collectPreviousReplies,
  isDuplicateReply,
} from '../src/lib/regenerateDedupe';
import { buildChatRequestBody } from '../src/lib/chatRequest';
import { serializeMessages } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P284 — hammering 「换一个」 used to degrade the reply to one short fixed
 * sentence and then repeat it verbatim while the bubble still wore a fresh
 * 「约 X 秒」 badge, so every click looked like a new version. Now the
 * regenerate request carries the last shown versions (the backend must not
 * repeat them and retries once when it still echoes), and an identical
 * reply no longer overwrites the bubble — it shows
 * 「这一版和上一版一样，再试一次？」 with a clickable retry instead of a
 * new latency row.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appSrc = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const bubbleSrc = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');

const SAME = '明天见面跟着展厅走就行，不用背话题。';
const DIFFERENT = '可以顺着她提过的展览聊，再补一句具体的邀约时间。';

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content: SAME,
  createdAt: 2,
  ...over,
});

const render = (message: ChatMessage) =>
  renderToStaticMarkup(
    createElement(MessageBubble, {
      message,
      onRegenerate: () => {},
    }),
  );

describe('P284 · isDuplicateReply', () => {
  it('returns true for identical text', () => {
    expect(isDuplicateReply(SAME, SAME)).toBe(true);
  });

  it('returns true for whitespace-only differences', () => {
    expect(isDuplicateReply(SAME, `  ${SAME}  `)).toBe(true);
    expect(isDuplicateReply('一句接一句，再补个问句。', '一句接一句，\n再补个问句。')).toBe(true);
    expect(isDuplicateReply('a b c', 'a   b\tc')).toBe(true);
  });

  it('returns false for different text', () => {
    expect(isDuplicateReply(SAME, DIFFERENT)).toBe(false);
    expect(isDuplicateReply(SAME, `${SAME}再加一句新内容。`)).toBe(false);
  });

  it('never flags an empty draft', () => {
    expect(isDuplicateReply('', '')).toBe(false);
    expect(isDuplicateReply(SAME, '   ')).toBe(false);
  });
});

describe('P284 · collectPreviousReplies', () => {
  it('collects the displayed text plus parked versions, deduped and capped at three', () => {
    const message = assistant({
      previousVersion: { content: DIFFERENT },
    });
    expect(collectPreviousReplies(message)).toEqual([SAME, DIFFERENT]);
  });

  it('skips parked versions whose text repeats the displayed one', () => {
    const message = assistant({
      previousVersion: { content: ` ${SAME}\n` },
    });
    expect(collectPreviousReplies(message)).toEqual([SAME]);
  });

  it('gathers both parked slots when a previous version is on screen', () => {
    const message = assistant({
      content: '旧版文本。',
      newerVersion: { content: '新版文本。' },
    });
    expect(collectPreviousReplies(message)).toEqual(['旧版文本。', '新版文本。']);
  });
});

describe('P284 · duplicate regen UI', () => {
  it('renders the retry hint instead of a fresh latency row', () => {
    const html = render(
      assistant({
        duplicateRegen: true,
        meta: { tokens: 120, latencyMs: 700 },
      }),
    );
    expect(html).toContain('这一版和上一版一样');
    expect(html).toContain('再试一次');
    expect(html).toContain('duplicate-note');
    expect(html).not.toContain('reply-meta');
    expect(html).not.toContain('约 0.7 秒');
  });

  it('keeps the retry clickable — the button re-issues 换一个 for the same bubble', () => {
    const html = render(assistant({ duplicateRegen: true }));
    const btnStart = html.indexOf('duplicate-retry-btn');
    expect(btnStart).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf('<button', btnStart), html.indexOf('>', btnStart) + 1);
    expect(tag).toContain('aria-label=');
    expect(tag).not.toContain('disabled');
    // The handler is the same one behind 换一个 — wiring guard below pins it.
  });

  it('a normal settled reply still shows the meta row and no duplicate note', () => {
    const html = render(assistant({ meta: { tokens: 120, latencyMs: 700 } }));
    expect(html).toContain('reply-meta');
    expect(html).not.toContain('duplicate-note');
    expect(html).not.toContain('这一版和上一版一样');
  });

  it('the duplicate note is transient — serializeMessages drops the flag', () => {
    const [out] = serializeMessages([assistant({ duplicateRegen: true })]);
    expect('duplicateRegen' in out).toBe(false);
  });
});

describe('P284 · wiring guards', () => {
  it('the note fires the same regenerate handler as 换一个', () => {
    const start = bubbleSrc.indexOf('duplicate-retry-btn');
    expect(start).toBeGreaterThan(-1);
    const block = bubbleSrc.slice(start, bubbleSrc.indexOf('</button>', start));
    expect(block).toContain('onClick={handleRegenerate}');
  });

  it('App passes previous versions into the regenerate stream and flags duplicates', () => {
    expect(appSrc).toContain('collectPreviousReplies(target)');
    expect(appSrc).toContain('streamReply(prompt, messageId, undefined, previousReplies, undefined, target.constraints)');
    expect(appSrc).toContain('isDuplicateReply(original.content, outcome.content)');
    expect(appSrc).toContain('duplicateRegen: true');
  });

  it('the request body only carries previousReplies when the field is non-empty', () => {
    const regenBody = JSON.parse(
      buildChatRequestBody({
        sessionId: 's-1',
        message: '明天见面聊啥？',
        language: 'auto',
        previousReplies: [SAME],
      }),
    ) as Record<string, unknown>;
    expect(regenBody.previousReplies).toEqual([SAME]);

    const normalBody = JSON.parse(
      buildChatRequestBody({
        sessionId: 's-1',
        message: '明天见面聊啥？',
        language: 'auto',
      }),
    ) as Record<string, unknown>;
    expect('previousReplies' in normalBody).toBe(false);
  });
});
