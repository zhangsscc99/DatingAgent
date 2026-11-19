/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P220 — sidebar information architecture dedupe. The 390px drawer rendered
 * 「快捷入口」 (优化资料 / 聊天回复 / 约会规划 / 匹配分析) and 「进阶工具」
 * (资料优化 / 聊天指导 / 约会规划 / 匹配分析 / 关系建议): four of eight rows
 * were effectively the same name, and a new user could not tell a prompt
 * template from a tool. The fix keeps the two sections but gives the quick
 * entries intent-shaped sentence labels, and the tool list's no-data fallback
 * now uses the real capability names instead of the quick-prompt labels —
 * so no feature name can ever render twice, even before /api/tools loads.
 * Source-level guards, same style as sidebar-no-emoji.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sidebar = readFileSync(join(SRC, 'components/Sidebar.tsx'), 'utf8');
// P355: the quick entries moved to the shared STARTER_ENTRIES — the one
// array the welcome block also renders.
const starterEntries = readFileSync(
  join(SRC, 'lib/starterEntries.ts'),
  'utf8',
);

function blockOf(
  src: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = src.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

const labelsIn = (block: string) =>
  [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);

const quickLabels = labelsIn(
  blockOf(starterEntries, 'const STARTER_ENTRIES', '];'),
);
const toolLabels = labelsIn(blockOf(sidebar, 'const TOOL_FALLBACK', '];'));

describe('P220 · sidebar quick entries and tools never share a name', () => {
  it('keeps both groups rendered under their own headings', () => {
    expect(sidebar).toContain('aria-label="快捷入口"');
    expect(sidebar).toContain('aria-label="进阶工具"');
    expect(sidebar.indexOf('aria-label="快捷入口"')).toBeLessThan(
      sidebar.indexOf('aria-label="进阶工具"'),
    );
  });

  it('quick entries still offer all four prompts', () => {
    expect(quickLabels).toHaveLength(4);
    const prompts = [
      ...blockOf(starterEntries, 'const STARTER_ENTRIES', '];').matchAll(
        /prompt: '([^']+)'/g,
      ),
    ].map((m) => m[1]);
    expect(prompts).toHaveLength(4);
  });

  it('no feature name appears in both lists', () => {
    expect(toolLabels.length).toBeGreaterThan(0);
    for (const name of quickLabels) {
      expect(toolLabels).not.toContain(name);
    }
    for (const name of toolLabels) {
      expect(quickLabels).not.toContain(name);
    }
  });

  it('every visible row label is unique across the drawer copy', () => {
    const all = [...quickLabels, ...toolLabels];
    expect(new Set(all).size).toBe(all.length);
  });

  it('quick-entry labels read as intents, not bare feature names', () => {
    for (const label of quickLabels) {
      // Intent-shaped sentences are longer than any tool capability name.
      expect(label.length).toBeGreaterThan(4);
    }
  });

  it('the tool list falls back to capability names, never quick labels', () => {
    const listBlock = blockOf(sidebar, 'className="tool-list"', '</ul>');
    expect(listBlock).toContain('tools.length ? tools : TOOL_FALLBACK');
    expect(listBlock).not.toContain('STARTER_ENTRIES');
  });
});
