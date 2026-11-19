/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatMessageCount } from '../src/components/Sidebar';
import type { ChatMessage } from '../src/types';

/**
 * P152 — sidebar 最近对话 message-count chip contract. Source-level guards
 * (same approach as session-filter.test.ts) lock in the markup wiring; the
 * behavioural block exercises the exported formatMessageCount helper that
 * the row renders (vitest runs in node, no DOM renderer).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const msgs = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? 'assistant' : 'user',
    content: `msg ${i}`,
  }));

describe('P152 · session row message count', () => {
  describe('source guards', () => {
    it('renders the chip inside the switch button, beside the relative time', () => {
      const sidebar = read('components/Sidebar.tsx');
      const btn = sidebar.slice(
        sidebar.indexOf('className={`recent-chat-item'),
        sidebar.indexOf('className="recent-chat-rename"'),
      );
      expect(btn).toContain('recent-chat-count');
      expect(btn).toContain('recent-chat-time');
      expect(btn.indexOf('recent-chat-time')).toBeLessThan(btn.indexOf('recent-chat-count'));
      expect(btn).toContain('formatMessageCount(s.messages)');
    });

    it('carries a 共 n 条消息 hover title and stays a plain span (no click target)', () => {
      const sidebar = read('components/Sidebar.tsx');
      const chip = sidebar.slice(
        sidebar.indexOf('recent-chat-count'),
        sidebar.indexOf('formatMessageCount(s.messages)'),
      );
      expect(chip).toContain('条消息');
      expect(chip).not.toContain('onClick');
      expect(chip).not.toContain('<button');
    });

    it('styles the chip dim and smaller than the title from existing tokens', () => {
      const css = read('components/Sidebar.css');
      const block = css.slice(css.indexOf('.recent-chat-count'));
      expect(block).toContain('var(--text-muted)');
      expect(block).toContain('font-size: 10px');
      expect(block).toContain('white-space: nowrap');
    });
  });

  describe('formatMessageCount behaviour', () => {
    it('labels a normal count', () => {
      expect(formatMessageCount(msgs(3))).toBe('3 条消息');
    });

    it('labels an empty array as 0 条消息', () => {
      expect(formatMessageCount([])).toBe('0 条消息');
    });

    it('labels a large count without truncation', () => {
      expect(formatMessageCount(msgs(1234))).toBe('1234 条消息');
    });

    it('treats undefined, null and non-array input as 0 条消息 without throwing', () => {
      expect(formatMessageCount(undefined)).toBe('0 条消息');
      expect(formatMessageCount(null)).toBe('0 条消息');
      expect(formatMessageCount('abc')).toBe('0 条消息');
      expect(formatMessageCount(42)).toBe('0 条消息');
      expect(formatMessageCount({ length: 9 })).toBe('0 条消息');
      expect(() => formatMessageCount(NaN)).not.toThrow();
    });

    it('does not mutate the array it is given', () => {
      const arr = msgs(4);
      const before = [...arr];
      formatMessageCount(arr);
      expect(arr).toEqual(before);
    });
  });
});
