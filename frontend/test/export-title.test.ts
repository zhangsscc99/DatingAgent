/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  buildConversationMarkdown,
  conversationFilename,
  sanitizeFilenamePart,
} from '../src/lib/exportConversation';

/**
 * P179 — exports used to carry a hardcoded `# DatingAgent 对话记录` heading
 * and a timestamp-only filename, so three sessions exported in the same
 * minute produced indistinguishable (or overwriting) files. These tests lock
 * the new contract: the session title lands in the heading and filename,
 * sanitizeFilenamePart strips filesystem-illegal characters while keeping
 * CJK, and blank titles fall back to the old byte-identical behaviour.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
// Fixed local-time instant -> stamp 20261116-0905 regardless of TZ.
const NOW = new Date(2026, 10, 16, 9, 5).getTime();
const LF = String.fromCharCode(10);

const messages: ChatMessage[] = [
  { id: 'u-1750000000000', role: 'user', content: '帮我优化约会资料' },
  { id: 'a-1750000060000', role: 'assistant', content: '当然，先看看你的介绍。' },
];

const firstLine = (md: string) => md.split(LF)[0];

describe('P179 · titled export', () => {
  it('puts the session title on the first markdown line', () => {
    const md = buildConversationMarkdown(messages, {
      title: '周末约会计划',
      exportedAt: NOW,
    });
    expect(firstLine(md)).toBe('# 周末约会计划');
  });

  it('flattens control characters so a title cannot break the heading', () => {
    const md = buildConversationMarkdown(messages, {
      title: `第一行${LF}第二行`,
      exportedAt: NOW,
    });
    expect(firstLine(md)).toBe('# 第一行 第二行');
  });

  it('includes the sanitized title in the filename', () => {
    expect(conversationFilename(NOW, '周末约会计划')).toBe(
      'datingagent-chat-周末约会计划-20261116-0905.md',
    );
  });
});

describe('P179 · sanitizeFilenamePart', () => {
  it('strips filesystem-illegal characters and control characters', () => {
    expect(sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(
      sanitizeFilenamePart(
        `n${String.fromCharCode(0)}u${String.fromCharCode(27)}l`,
      ),
    ).toBe('nul');
  });

  it('keeps CJK and internal spaces, strips only edge dots/spaces', () => {
    expect(sanitizeFilenamePart('周末 约会:计划')).toBe('周末 约会计划');
    expect(sanitizeFilenamePart('  ..约会..  ')).toBe('约会');
  });

  it('truncates to 40 characters', () => {
    expect(sanitizeFilenamePart('x'.repeat(50))).toBe('x'.repeat(40));
    expect(sanitizeFilenamePart('标'.repeat(45))).toBe('标'.repeat(40));
  });

  it('returns "" for blank or fully-stripped input', () => {
    expect(sanitizeFilenamePart('')).toBe('');
    expect(sanitizeFilenamePart('   ')).toBe('');
    expect(sanitizeFilenamePart('???')).toBe('');
    expect(sanitizeFilenamePart('...')).toBe('');
    expect(sanitizeFilenamePart(String.fromCharCode(0))).toBe('');
  });
});

describe('P179 · fallback and regression', () => {
  it('falls back to the default heading for blank/whitespace titles', () => {
    const blanks = ['', '   ', ` ${String.fromCharCode(9)} `, String.fromCharCode(0)];
    for (const title of blanks) {
      const md = buildConversationMarkdown(messages, { title, exportedAt: NOW });
      expect(firstLine(md)).toBe('# DatingAgent 对话记录');
    }
  });

  it('keeps the timestamp-only filename for blank or fully-stripped titles', () => {
    expect(conversationFilename(NOW)).toBe('datingagent-chat-20261116-0905.md');
    expect(conversationFilename(NOW, '   ')).toBe(
      'datingagent-chat-20261116-0905.md',
    );
    expect(conversationFilename(NOW, '???')).toBe(
      'datingagent-chat-20261116-0905.md',
    );
    expect(conversationFilename()).toMatch(/^datingagent-chat-\d{8}-\d{4}\.md$/);
  });

  it('produces byte-identical output for a no-title call', () => {
    const baseline = buildConversationMarkdown(messages, { exportedAt: NOW });
    expect(baseline).toBe(
      buildConversationMarkdown(messages, { exportedAt: NOW, title: undefined }),
    );
    expect(baseline.startsWith(`# DatingAgent 对话记录${LF}${LF}- 导出时间：`)).toBe(
      true,
    );
  });
});

describe('P179 · App wiring', () => {
  it('export and copy entry points pass the session title through', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toContain('buildConversationMarkdown(messages, { title');
    expect(app).toContain('conversationFilename(now, title)');
    expect(app).toContain('sessionTitle(messages)');
  });
});
