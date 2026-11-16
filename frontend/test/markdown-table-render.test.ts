/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeMarkdownTables,
  splitTableRow,
  stripCellEmoji,
} from '../src/lib/markdownTables';

/**
 * P197 — assistant replies with GFM pipe tables collapsed into one paragraph
 * of raw `|` because ReactMarkdown runs without remark-gfm. The fix converts
 * tables to bullet lists in a pure pre-pass (frontend/src/lib/markdownTables.ts).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleTsx = readFileSync(
  join(SRC, 'components', 'MessageBubble.tsx'),
  'utf8',
);

const TABLE_2COL = [
  '| 类型 | 为什么合适 |',
  '|------|------|',
  '| 云南菜 / 东南亚 | 口味大众接受度高，菜品色彩明快 |',
  '| 日料 | 环境安静，适合聊天 |',
].join('\n');

describe('P197 · markdown table → bullet list', () => {
  it('converts a 2-column table to bullets with no pipes or --- separator', () => {
    const out = normalizeMarkdownTables(TABLE_2COL);
    expect(out).not.toContain('|');
    expect(out).not.toContain('---');
    expect(out).toContain('- **云南菜 / 东南亚**：口味大众接受度高，菜品色彩明快');
    expect(out).toContain('- **日料**：环境安静，适合聊天');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('joins 3+ columns with ` · `', () => {
    const src = [
      '| 类型 | 预算 | 氛围 |',
      '|---|---|---|',
      '| 云南菜 | 人均 80 | 热闹 |',
      '| 日料 | 人均 150 | 安静 |',
    ].join('\n');
    const out = normalizeMarkdownTables(src);
    expect(out).not.toContain('|');
    expect(out).toContain('- **云南菜**：人均 80 · 热闹');
    expect(out).toContain('- **日料**：人均 150 · 安静');
  });

  it('leaves a separator-looking block inside a fenced code block untouched', () => {
    const src = ['```md', TABLE_2COL, '```'].join('\n');
    expect(normalizeMarkdownTables(src)).toBe(src);
  });

  it('does not split a cell on an escaped \\|', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    const src = ['| 名称 | 说明 |', '|---|---|', '| a \\| b | 第二列 |'].join(
      '\n',
    );
    const out = normalizeMarkdownTables(src);
    expect(out).toContain('- **a | b**：第二列');
  });

  it('strips emoji from the first column only, keeping the text', () => {
    const src = [
      '| 服务 | 说明 |',
      '|------|------|',
      '| 💡 资料优化 | 帮你改照片 ✨ |',
    ].join('\n');
    const out = normalizeMarkdownTables(src);
    expect(out).toBe('- **资料优化**：帮你改照片 ✨');
    expect(stripCellEmoji('💡 资料优化')).toBe('资料优化');
  });

  it('passes paragraphs, headings, lists and blockquotes through byte-identically', () => {
    const src = [
      '# 标题',
      '',
      '一段普通**加粗**文字。',
      '',
      '- 已有列表项',
      '> 引用一行',
      '',
      'inline `code | with pipe` 不算表格',
    ].join('\n');
    expect(normalizeMarkdownTables(src)).toBe(src);
  });

  it('returns a truncated table (header with no separator) unchanged', () => {
    const src = '前文\n| 类型 | 为什么合适 |';
    expect(normalizeMarkdownTables(src)).toBe(src);
  });

  it('keeps non-table text around a converted table byte-identically', () => {
    const src = `开头一段\n\n${TABLE_2COL}\n\n结尾一段`;
    const out = normalizeMarkdownTables(src);
    expect(out.startsWith('开头一段\n\n')).toBe(true);
    expect(out.endsWith('\n\n结尾一段')).toBe(true);
  });

  it('does not double-wrap already-bold first-column cells', () => {
    const src = ['| 维度 | a |', '|---|---|', '| **氛围** | 轻松 |'].join('\n');
    const out = normalizeMarkdownTables(src);
    expect(out).toBe('- **氛围**：轻松');
  });

  it('pads short body rows and appends extras to the last cell', () => {
    const src = [
      '| a | b | c |',
      '|---|---|---|',
      '| x | y |',
      '| p | q | r | extra |',
    ].join('\n');
    const out = normalizeMarkdownTables(src);
    expect(out).toContain('- **x**：y');
    expect(out).toContain('- **p**：q · r · extra');
  });
});

describe('P197 · MessageBubble wiring', () => {
  it('renders assistant content through normalizeMarkdownTables', () => {
    expect(bubbleTsx).toContain('normalizeMarkdownTables');
    expect(bubbleTsx).toMatch(
      /<ReactMarkdown>\{markdownContent\}<\/ReactMarkdown>/,
    );
  });
});
