/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P199 — sidebar emoji-free contract. vitest runs in the node environment
 * (no DOM renderer, same as recent-chat-empty-filter.test.ts), so these
 * source guards lock the rendered markup: no Extended_Pictographic code
 * points anywhere in Sidebar.tsx (quick entries, tool rows, the 设置 gear),
 * inline currentColor-stroke SVGs replacing the old emoji spans, and the
 * quick-entry list still holding its original four items.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebar = read('components/Sidebar.tsx');
const EMOJI = /\p{Extended_Pictographic}/u;

describe('P199 · sidebar has no emoji icons', () => {
  it('the sidebar source contains no emoji code points', () => {
    expect(EMOJI.test(sidebar)).toBe(false);
  });

  it('renders inline SVG icons (aria-hidden, currentColor stroke)', () => {
    expect(sidebar).toContain('<svg');
    expect(sidebar).toContain('stroke="currentColor"');
    expect(sidebar).toContain('aria-hidden="true"');
    // Quick-entry rows mount the shared icon component, not a glyph span.
    expect(sidebar).toContain('<SidebarIcon iconKey={p.iconKey} />');
    expect(sidebar).not.toContain('{p.icon}');
  });

  it('drops the emoji span from 进阶工具 rows — labels carry the meaning', () => {
    const listStart = sidebar.indexOf('className="tool-list"');
    const toolBlock = sidebar.slice(
      listStart,
      sidebar.indexOf('</ul>', listStart),
    );
    expect(toolBlock).not.toContain('{t.icon}');
    expect(toolBlock).not.toContain('<span aria-hidden="true">');
    // P285: the row label resolves through TOOL_LABELS (toolDisplayName)
    // so /api/tools module names never reach the drawer.
    expect(toolBlock).toContain('{toolDisplayName(t.name) ?? t.label}');
  });

  it('keeps the quick-entry item count and order unchanged', () => {
    // P355: the entries now live in the shared STARTER_ENTRIES — the same
    // array the welcome block renders — and it stays emoji-free too.
    const entries = read('lib/starterEntries.ts');
    expect(EMOJI.test(entries)).toBe(false);
    const quickBlock = entries.slice(
      entries.indexOf('const STARTER_ENTRIES'),
      entries.indexOf('];'),
    );
    const labels = [...quickBlock.matchAll(/label: '([^']+)'/g)].map(
      (m) => m[1],
    );
    // P220: labels are intent-shaped sentences, distinct from tool names.
    expect(labels).toEqual([
      '帮我优化资料',
      '她这样回我怎么接',
      '帮我规划第一次约会',
      '我们合不合适',
    ]);
  });

  it('keeps the 设置 row labelled while its prefix is now an SVG', () => {
    const settingsBlock = sidebar.slice(
      sidebar.indexOf('className="settings-open-btn"'),
      sidebar.indexOf('</button>', sidebar.indexOf('settings-open-btn')),
    );
    expect(settingsBlock).toContain('aria-label="设置"');
    expect(settingsBlock).toContain('<svg');
    expect(settingsBlock).not.toContain('⚙');
    expect(EMOJI.test(settingsBlock)).toBe(false);
  });
});
