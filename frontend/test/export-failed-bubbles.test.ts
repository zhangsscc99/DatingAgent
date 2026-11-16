/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  buildConversationMarkdown,
  exportableMessages,
} from '../src/lib/exportConversation';

/**
 * P180 — failed and stopped replies used to vanish from the Markdown
 * export: `exportableMessages` dropped any bubble with `error` or empty
 * content, so a saved transcript silently disagreed with the screen and a
 * thread whose only finished turn failed could not be exported at all.
 * These tests lock the new contract: every non-streaming bubble exports,
 * an unusable assistant bubble becomes a single blockquote placeholder
 * under its normal heading, and a failure-free conversation stays
 * byte-identical to the old renderer.
 */

const LF = String.fromCharCode(10);
// Local-time instants, so the golden strings hold in any machine TZ.
const T_USER = new Date(2026, 10, 16, 9, 0).getTime();
const T_ASSISTANT = new Date(2026, 10, 16, 9, 1).getTime();
const T_LATER = new Date(2026, 10, 16, 9, 2).getTime();
const NOW = new Date(2026, 10, 16, 9, 5).getTime();

const user = (content: string, createdAt: number = T_USER): ChatMessage => ({
  id: `u-${createdAt}`,
  role: 'user',
  content,
  createdAt,
});

const assistant = (
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: `a-${T_ASSISTANT}`,
  role: 'assistant',
  content,
  createdAt: T_ASSISTANT,
  ...extra,
});

const placeholderLines = (md: string): string[] =>
  md.split(LF).filter((line) => line.startsWith('> （此条回复生成失败或已停止'));

describe('P180 · failed bubbles stay in the export', () => {
  it('an error bubble keeps its heading and emits exactly one placeholder line', () => {
    const md = buildConversationMarkdown(
      [user('你好'), assistant('请求失败：服务暂时不可用', { error: true })],
      { exportedAt: NOW },
    );
    expect(placeholderLines(md)).toEqual([
      '> （此条回复生成失败或已停止：请求失败：服务暂时不可用）',
    ]);
    expect(md).toContain('## DatingAgent · 2026-11-16 09:01');
    expect(md).toContain('- 消息数：2');
  });

  it('an empty stopped assistant bubble emits a bare placeholder', () => {
    const md = buildConversationMarkdown(
      [user('你好'), assistant('   ', { stopped: true })],
      { exportedAt: NOW },
    );
    expect(placeholderLines(md)).toEqual(['> （此条回复生成失败或已停止）']);
    expect(md).toContain('## DatingAgent · 2026-11-16 09:01');
  });

  it('prefers errorDetail when a regenerated reply failed', () => {
    const md = buildConversationMarkdown(
      [
        assistant('旧的正常回复', {
          error: true,
          errorDetail: '出错了：模型超时',
        }),
      ],
      { exportedAt: NOW },
    );
    expect(placeholderLines(md)).toEqual([
      '> （此条回复生成失败或已停止：出错了：模型超时）',
    ]);
    expect(md).not.toContain('旧的正常回复');
  });

  it('escapes untrusted error text inside the placeholder', () => {
    const md = buildConversationMarkdown(
      [user('你好'), assistant('<script>alert(1)</script>', { error: true })],
      { exportedAt: NOW },
    );
    expect(md).toContain(
      '> （此条回复生成失败或已停止：&lt;script&gt;alert(1)&lt;/script&gt;）',
    );
    expect(md).not.toContain('<script>');
  });

  it('keeps chronological order across normal and failed turns', () => {
    const md = buildConversationMarkdown(
      [
        user('第一条'),
        assistant('请求失败：网关超时', { error: true }),
        user('第二条', T_LATER),
        assistant('好的，安排。', { id: 'a-2', createdAt: T_LATER }),
      ],
      { exportedAt: NOW },
    );
    const headings = [
      '## 你 · 2026-11-16 09:00',
      '## DatingAgent · 2026-11-16 09:01',
      '## 你 · 2026-11-16 09:02',
      '## DatingAgent · 2026-11-16 09:02',
    ];
    const positions = headings.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md).toContain('- 消息数：4');
  });

  it('still skips in-flight streams and empty user bubbles', () => {
    const md = buildConversationMarkdown(
      [user('你好'), assistant('', { streaming: true }), user('   ')],
      { exportedAt: NOW },
    );
    expect(md).toContain('- 消息数：1');
    expect(md).not.toContain('## DatingAgent');
  });

  it('a conversation whose only finished turn is a failure is exportable', () => {
    const failed = [
      user('你好'),
      assistant('暂无回复，请重试。', { error: true }),
    ];
    expect(exportableMessages(failed)).toHaveLength(2);
    // Even a bare failed bubble with no surviving user turn still exports.
    expect(exportableMessages([assistant('', { error: true })])).toHaveLength(1);
  });
});

describe('P180 · normal conversations are byte-identical', () => {
  it('produces the pre-change markdown for a clean conversation', () => {
    const md = buildConversationMarkdown(
      [user('帮我优化约会资料'), assistant('当然，先看看你的介绍。')],
      { exportedAt: NOW },
    );
    expect(md).toBe(
      [
        '# DatingAgent 对话记录',
        '',
        '- 导出时间：2026-11-16 09:05',
        '- 消息数：2',
        '',
        '## 你 · 2026-11-16 09:00',
        '',
        '帮我优化约会资料',
        '',
        '---',
        '',
        '## DatingAgent · 2026-11-16 09:01',
        '',
        '当然，先看看你的介绍。',
        '',
      ].join(LF),
    );
  });
});
