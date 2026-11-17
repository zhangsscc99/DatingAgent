/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  filterRecentSessions,
  matchSessionMessage,
} from '../src/lib/sessionFilter';
import type { StoredChatSession } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P230 — sidebar filter body-match contract. The 筛选对话 box now matches
 * the session's message text, not only its auto-derived title; rows kept
 * only by a body hit show a dim excerpt under the title, and a
 * visually-hidden live region announces the result count. Behavioural
 * blocks exercise the pure helpers (vitest runs in node, no DOM renderer);
 * source guards — same approach as session-filter.test.ts — lock in the
 * Sidebar wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const msg = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
): ChatMessage => ({ id, role, content });

const session = (
  id: string,
  title: string,
  messages: ChatMessage[],
): StoredChatSession => ({ id, title, updatedAt: 1, messages });

const BODY_SESSION = session(
  's-body',
  '今天和她第一次约会,聊得很开心…',
  [
    msg('m1', 'user', '今天和她第一次约会,聊得很开心,我想继续'),
    msg('m2', 'assistant', '听起来很不错,后来呢'),
    msg('m3', 'user', '我妈催我相亲,你怎么看'),
  ],
);
const TITLE_SESSION = session('s-title', '相亲经验总结', [
  msg('t1', 'user', '随便聊聊'),
]);

describe('P230 · sidebar filter matches message body', () => {
  it('finds a session whose title lacks the keyword but whose messages contain it', () => {
    const hits = filterRecentSessions([BODY_SESSION], '相亲');
    expect(hits).toEqual([BODY_SESSION]);
  });

  it('still matches on the title and never mutates the input', () => {
    const sessions = [TITLE_SESSION, BODY_SESSION];
    const before = [...sessions];
    expect(filterRecentSessions(sessions, '相亲')).toHaveLength(2);
    expect(sessions).toEqual(before);
  });

  it('returns the same array (order + identity) for empty or blank queries', () => {
    const sessions = [BODY_SESSION, TITLE_SESSION];
    expect(filterRecentSessions(sessions, '')).toBe(sessions);
    expect(filterRecentSessions(sessions, '   ')).toBe(sessions);
    expect(matchSessionMessage(BODY_SESSION, '')).toBeNull();
  });

  it('returns [] when nothing matches so the 没有匹配 empty state still renders', () => {
    expect(filterRecentSessions([BODY_SESSION], '不存在的词')).toEqual([]);
    expect(matchSessionMessage(BODY_SESSION, '不存在的词')).toBeNull();
  });

  describe('matchSessionMessage excerpt', () => {
    it('contains the keyword, stays <= 44 chars and ellipsises truncated ends', () => {
      const long =
        '前面很长很长的一段铺垫文字,反复聊了很多日常细节之后,我妈催我相亲,后面还有更多的话继续说下去,说到很晚才结束这个话题';
      const s = session('s-long', '无关键词标题', [msg('u1', 'user', long)]);
      const hit = matchSessionMessage(s, '相亲');
      expect(hit).not.toBeNull();
      expect(hit!.role).toBe('user');
      expect(hit!.excerpt).toContain('相亲');
      expect(hit!.excerpt.length).toBeLessThanOrEqual(44);
      expect(hit!.excerpt.startsWith('…')).toBe(true);
      expect(hit!.excerpt.endsWith('…')).toBe(true);
    });

    it('returns the collapsed message text when it already fits', () => {
      const hit = matchSessionMessage(BODY_SESSION, '相亲');
      expect(hit).not.toBeNull();
      expect(hit!.excerpt).toBe('我妈催我相亲,你怎么看');
    });

    it('collapses whitespace before clipping the excerpt', () => {
      const s = session('s-ws', '标题', [
        msg('u1', 'user', '我妈催我\n  相亲   你怎么看'),
      ]);
      expect(matchSessionMessage(s, '相亲')!.excerpt).toBe(
        '我妈催我 相亲 你怎么看',
      );
    });

    it('strips markdown markers before cutting the excerpt (P238)', () => {
      const s = session('s-md', '标题', [
        msg(
          'u1',
          'assistant',
          '** - 确认好时间、地点、是否需要预约 - 稍微了解一下展览主题，但不必背下来',
        ),
      ]);
      const hit = matchSessionMessage(s, '预约');
      expect(hit).not.toBeNull();
      expect(hit!.excerpt).toContain('预约');
      expect(hit!.excerpt).not.toContain('**');
      expect(hit!.excerpt).not.toContain('*');
      expect(hit!.excerpt).not.toMatch(/^\s*-\s/);
      expect(hit!.excerpt).not.toContain('#');
      expect(hit!.excerpt).not.toContain('>');
      expect(hit!.excerpt).not.toContain('`');
    });

    it('cleans headings, blockquotes, inline emphasis and code (P238)', () => {
      const s = session('s-md2', '标题', [
        msg(
          'u1',
          'assistant',
          '前面铺垫\n## 约会清单\n> 记住这几件事\n- 确认是否需要预约，别忘带伞\n用 `calendar` 记录一下_重点_内容',
        ),
      ]);
      const hit = matchSessionMessage(s, '预约');
      expect(hit).not.toBeNull();
      expect(hit!.excerpt).toContain('预约');
      expect(hit!.excerpt).not.toMatch(/[#>*`_]/);
      expect(hit!.excerpt).not.toMatch(/^\s*-\s/);
      expect(hit!.excerpt.length).toBeLessThanOrEqual(44);
    });

    it('does not glue words where markers were stripped (P238)', () => {
      const s = session('s-md3', '标题', [
        msg('u1', 'assistant', '见面地点在**美术馆**门口,记得提前预约'),
      ]);
      const hit = matchSessionMessage(s, '预约');
      expect(hit).not.toBeNull();
      expect(hit!.excerpt).toContain('美术馆');
      expect(hit!.excerpt).not.toContain('**');
    });

    it('keeps body filtering working on markdown content (P238)', () => {
      const s = session('s-md4', '无关标题', [
        msg('u1', 'assistant', '## 注意\n- 是否需要预约展览门票'),
      ]);
      expect(filterRecentSessions([s], '预约')).toEqual([s]);
    });

    it('matches assistant messages too and reports their role', () => {
      const s = session('s-asst', '标题', [
        msg('u1', 'user', '没有这个词'),
        msg('a1', 'assistant', '相亲这件事可以慢慢聊'),
      ]);
      const hit = matchSessionMessage(s, '相亲');
      expect(hit!.role).toBe('assistant');
      expect(hit!.excerpt).toContain('相亲');
    });
  });

  describe('source guards', () => {
    const sidebar = read('components/Sidebar.tsx');

    it('renders a dim excerpt under the title for body-only matches', () => {
      expect(sidebar).toContain('matchSessionMessage(s, filterQuery)');
      // The excerpt sits inside the row button, after the title span, and is
      // gated on the title NOT matching so title hits never double-render.
      const titleIdx = sidebar.indexOf('recent-chat-title');
      const excerptIdx = sidebar.indexOf('recent-chat-excerpt');
      expect(excerptIdx).toBeGreaterThan(titleIdx);
      expect(excerptIdx).toBeLessThan(
        sidebar.indexOf('recent-chat-meta', titleIdx),
      );
      expect(sidebar).toContain('!s.title.toLowerCase().includes(trimmedQuery)');
      expect(sidebar).toContain('{bodyMatch && (');
    });

    it('announces the result count in a visually-hidden live region', () => {
      expect(sidebar).toContain('找到 ');
      expect(sidebar).toContain('没有匹配的对话');
      expect(sidebar).toContain('className="sr-only" role="status" aria-live="polite"');
    });

    it('keeps the excerpt styling dim and single-line', () => {
      const css = read('components/Sidebar.css');
      expect(css).toContain('.recent-chat-excerpt');
      const block = css.slice(
        css.indexOf('.recent-chat-excerpt'),
        css.indexOf('.recent-chat-meta'),
      );
      expect(block).toContain('--text-muted');
      expect(block).toContain('white-space: nowrap');
    });
  });
});
