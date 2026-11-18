/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P207 — tool-badge emoji-free contract. vitest runs in the node environment
 * (no DOM renderer, same as sidebar-no-emoji.test.ts), so these source guards
 * lock the rendered markup: no Extended_Pictographic code points anywhere in
 * ToolBadge.tsx, inline currentColor-stroke SVGs replacing the old emoji map,
 * and the tool-name → Chinese label mapping in lib/toolLabels.ts unchanged.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const badge = read('components/ToolBadge.tsx');
const labels = read('lib/toolLabels.ts');
const EMOJI = /\p{Extended_Pictographic}/u;

describe('P207 · tool badge has no emoji icons', () => {
  it('the badge source renders no emoji code points', () => {
    expect(EMOJI.test(badge)).toBe(false);
  });

  it('renders inline SVG icons (aria-hidden, currentColor stroke)', () => {
    expect(badge).toContain('<svg');
    expect(badge).toContain('stroke="currentColor"');
    expect(badge).toContain('aria-hidden="true"');
    // Every known tool keeps a dedicated icon path entry.
    for (const name of [
      'analyze_profile',
      'coach_conversation',
      'plan_date',
      'check_compatibility',
      'get_relationship_advice',
    ]) {
      expect(badge).toContain(`${name}:`);
    }
  });

  it('keeps the visible label, status semantics and check state', () => {
    expect(badge).toContain('{event.label}');
    expect(badge).toContain(`aria-label={isRunning ? '执行中' : '完成'}`);
    expect(badge).toContain('event.status');
    expect(badge).toContain('✓');
    expect(badge).toContain('className="spinner"');
  });

  it('keeps the tool-name → Chinese label mapping unchanged', () => {
    const mapStart = labels.indexOf('const TOOL_LABELS');
    const mapBlock = labels.slice(mapStart, labels.indexOf('};', mapStart));
    expect(mapBlock).toContain("analyze_profile: '改资料'");
    expect(mapBlock).toContain("coach_conversation: '接话术'");
    expect(mapBlock).toContain("plan_date: '排约会'");
    expect(mapBlock).toContain("get_relationship_advice: '关系建议'");
  });
});
