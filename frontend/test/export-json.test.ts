/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ToolEvent } from '../src/types';
import {
  buildConversationJson,
  buildConversationMarkdown,
  conversationJsonFilename,
  formatUtcOffset,
  type ConversationJsonExport,
} from '../src/lib/exportConversation';

/**
 * P181 — the Markdown export is human-readable only; a saved conversation
 * could not be replayed structurally (who said what, when, with which
 * tools). These tests lock the JSON contract: same bubbles as Markdown
 * (`exportableMessages`), ISO-8601 timestamps carrying the UTC offset, the
 * P180 placeholder for failed/empty assistant bubbles, the P179 title and
 * filename rules, and the Markdown path left byte-identical.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const LF = String.fromCharCode(10);
// Local-time instants, so assertions hold in any machine TZ.
const T_USER = new Date(2026, 10, 16, 9, 0).getTime();
const T_ASSISTANT = new Date(2026, 10, 16, 9, 1).getTime();
const NOW = new Date(2026, 10, 16, 9, 5).getTime();

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
// P182 — local UTC-offset suffix appended to Markdown timestamps.
const TZ = ` (${formatUtcOffset(new Date(NOW))})`;

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

const parse = (json: string): ConversationJsonExport =>
  JSON.parse(json) as ConversationJsonExport;

describe('P181 · JSON export document', () => {
  it('produces parseable JSON with the declared top-level shape', () => {
    const json = buildConversationJson(
      [user('你好'), assistant('你好呀！')],
      { exportedAt: NOW },
    );
    const doc = parse(json);
    expect(doc.title).toBe('DatingAgent 对话记录');
    expect(doc.exportedAt).toMatch(ISO_OFFSET);
    expect(doc.exportedAt.startsWith('2026-11-16T09:05:00')).toBe(true);
    expect(Array.isArray(doc.messages)).toBe(true);
    expect(doc.messages).toHaveLength(2);
  });

  it('carries roles, ISO-8601 offset timestamps, and toolEvents verbatim', () => {
    const toolEvents: ToolEvent[] = [
      { name: 'plan_date', label: '排约会', status: 'done', result: { ok: true } },
    ];
    const doc = parse(
      buildConversationJson(
        [user('帮我计划周末约会'), assistant('好的。', { toolEvents })],
        { exportedAt: NOW },
      ),
    );
    expect(doc.messages[0].role).toBe('user');
    expect(doc.messages[0].createdAt).toMatch(/^2026-11-16T09:00:00[+-]\d{2}:\d{2}$/);
    expect(doc.messages[0].content).toBe('帮我计划周末约会');
    expect(doc.messages[0].toolEvents).toEqual([]);
    expect(doc.messages[1].role).toBe('assistant');
    expect(doc.messages[1].createdAt).toMatch(/^2026-11-16T09:01:00[+-]\d{2}:\d{2}$/);
    expect(doc.messages[1].toolEvents).toEqual(toolEvents);
  });

  it('derives createdAt from the id epoch when createdAt is absent, null when neither exists', () => {
    const doc = parse(
      buildConversationJson(
        [
          { id: 'u-1750000000000', role: 'user', content: '旧消息' },
          { id: 'legacy-1', role: 'user', content: '没有时间' },
        ],
        { exportedAt: NOW },
      ),
    );
    expect(doc.messages[0].createdAt).toMatch(ISO_OFFSET);
    expect(doc.messages[1].createdAt).toBeNull();
  });

  it('excludes in-flight streams and empty user bubbles, like Markdown', () => {
    const doc = parse(
      buildConversationJson(
        [user('你好'), assistant('', { streaming: true }), user('   ')],
        { exportedAt: NOW },
      ),
    );
    expect(doc.messages).toHaveLength(1);
    expect(doc.messages[0].role).toBe('user');
  });

  it('represents a failed assistant bubble with the same placeholder text, never dropped', () => {
    const doc = parse(
      buildConversationJson(
        [user('你好'), assistant('请求失败：服务暂时不可用', { error: true })],
        { exportedAt: NOW },
      ),
    );
    expect(doc.messages).toHaveLength(2);
    expect(doc.messages[1].content).toBe(
      '（此条回复生成失败或已停止：请求失败：服务暂时不可用）',
    );
    // The schema is the contract — no raw error flag leaks through.
    expect('error' in doc.messages[1]).toBe(false);
  });

  it('represents an empty stopped assistant bubble with the bare placeholder', () => {
    const doc = parse(
      buildConversationJson(
        [user('你好'), assistant('   ', { stopped: true })],
        { exportedAt: NOW },
      ),
    );
    expect(doc.messages[1].content).toBe('（此条回复生成失败或已停止）');
  });

  it('does not HTML-escape JSON content — it is data, not markup', () => {
    const doc = parse(
      buildConversationJson([user('a < b & c > d')], { exportedAt: NOW }),
    );
    expect(doc.messages[0].content).toBe('a < b & c > d');
    const docErr = parse(
      buildConversationJson(
        [assistant('<x>', { error: true })],
        { exportedAt: NOW },
      ),
    );
    expect(docErr.messages[0].content).toBe('（此条回复生成失败或已停止：<x>）');
  });

  it('normalises the title like Markdown (control chars flattened, plain text)', () => {
    const doc = parse(
      buildConversationJson([user('你好')], {
        title: `第一行${LF}第二行`,
        exportedAt: NOW,
      }),
    );
    expect(doc.title).toBe('第一行 第二行');
  });

  it('propagates a session title and falls back for blank titles', () => {
    const titled = parse(
      buildConversationJson([user('你好')], { title: '周末约会计划', exportedAt: NOW }),
    );
    expect(titled.title).toBe('周末约会计划');
    for (const title of ['', '   ', ` ${String.fromCharCode(9)} `]) {
      const doc = parse(
        buildConversationJson([user('你好')], { title, exportedAt: NOW }),
      );
      expect(doc.title).toBe('DatingAgent 对话记录');
    }
  });
});

describe('P181 · conversationJsonFilename', () => {
  it('includes the sanitized title and a .json extension', () => {
    expect(conversationJsonFilename(NOW, '周末约会计划')).toBe(
      'datingagent-chat-周末约会计划-20261116-0905.json',
    );
    expect(conversationJsonFilename(NOW, 'a/b:c*d?e')).toBe(
      'datingagent-chat-abcde-20261116-0905.json',
    );
  });

  it('falls back to the plain timestamped name when nothing usable remains', () => {
    expect(conversationJsonFilename(NOW)).toBe(
      'datingagent-chat-20261116-0905.json',
    );
    expect(conversationJsonFilename(NOW, '???')).toBe(
      'datingagent-chat-20261116-0905.json',
    );
    expect(conversationJsonFilename(NOW, '   ')).toBe(
      'datingagent-chat-20261116-0905.json',
    );
    expect(conversationJsonFilename()).toMatch(
      /^datingagent-chat-\d{8}-\d{4}\.json$/,
    );
  });
});

describe('P181 · Markdown output is unchanged', () => {
  it('stays byte-identical to the pre-P181 renderer for the same input', () => {
    const messages: ChatMessage[] = [
      user('帮我优化约会资料'),
      assistant('当然，先看看你的介绍。'),
      user('第二条', new Date(2026, 10, 16, 9, 2).getTime()),
      assistant('请求失败：网关超时', {
        error: true,
        id: 'a-err',
        createdAt: new Date(2026, 10, 16, 9, 3).getTime(),
      }),
    ];
    expect(buildConversationMarkdown(messages, { exportedAt: NOW })).toBe(
      [
        '# DatingAgent 对话记录',
        '',
        `- 导出时间：2026-11-16 09:05${TZ}`,
        '- 消息数：4',
        '',
        `## 你 · 2026-11-16 09:00${TZ}`,
        '',
        '帮我优化约会资料',
        '',
        '---',
        '',
        `## DatingAgent · 2026-11-16 09:01${TZ}`,
        '',
        '当然，先看看你的介绍。',
        '',
        '---',
        '',
        `## 你 · 2026-11-16 09:02${TZ}`,
        '',
        '第二条',
        '',
        '---',
        '',
        `## DatingAgent · 2026-11-16 09:03${TZ}`,
        '',
        '> （此条回复生成失败或已停止：请求失败：网关超时）',
        '',
      ].join(LF),
    );
  });
});

describe('P181 · App wiring', () => {
  it('the JSON export entry point passes title and timestamp through', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toContain('buildConversationJson(messages, { title');
    expect(app).toContain('conversationJsonFilename(now, title)');
    expect(app).toContain('导出 JSON');
    expect(app).toContain('disabled={!canExport}');
  });
});
