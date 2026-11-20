/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P402 — the sidebar's two bottom-of-list controls were one stray tap
 * apart and wore the same glyph: 清空全部对话 (destructive, wipes the
 * whole history) sat directly above 回收站 (navigation, opens a sheet)
 * and BOTH rendered the 'trash' icon — the same shape carrying opposite
 * semantics on one screen (vision walkthrough at 390×844 called it the
 * screen's biggest UX risk).
 *
 * The fix keeps 'trash' only on the destructive button and moves the
 * 回收站 row onto a new 'history' clock glyph, pins each control's glyph
 * identity via a data-icon attribute, and grows the row's margin-top so
 * the two controls are ≥50px apart (36px clear-all height + ≥16px gap).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebar = read('components/Sidebar.tsx');
const sidebarCss = read('components/Sidebar.css');
// Declarations only — comments may legitimately *mention* values; the
// contract applies to live rules.
const sidebarCssDecl = sidebarCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

/** The JSX block from `marker` up to and including the next `</button>`. */
function buttonBlock(marker: string): string {
  const start = sidebar.indexOf(marker);
  expect(start, `${marker} missing from Sidebar.tsx`).toBeGreaterThan(-1);
  const end = sidebar.indexOf('</button>', start);
  expect(end, `no </button> after ${marker}`).toBeGreaterThan(start);
  return sidebar.slice(start, end);
}

const CLEAR_ALL = buttonBlock('className="recent-chat-clear-all"');
const TRASH_ROW = buttonBlock('className="recent-chat-trash"');

describe('P402 · destructive clear-all vs 回收站 navigation — distinct glyphs', () => {
  it('the 清空全部对话 button keeps the trash glyph, pinned via data-icon="trash"', () => {
    expect(CLEAR_ALL).toContain('data-icon="trash"');
    expect(CLEAR_ALL).toContain('iconKey="trash"');
    // Destructive affordances stay: shared danger tone + busy disable.
    expect(CLEAR_ALL).toContain('data-tone="danger"');
    expect(CLEAR_ALL).toContain('disabled={busy}');
  });

  it('the 回收站 row no longer renders the trash glyph', () => {
    expect(TRASH_ROW).not.toContain('iconKey="trash"');
    const icon = /data-icon="([^"]+)"/.exec(TRASH_ROW);
    expect(icon, '回收站 row must pin its glyph via data-icon').not.toBeNull();
    expect(icon![1]).not.toBe('trash');
    // The replacement is the 'history' clock — navigation, not destruction.
    expect(icon![1]).toBe('history');
    expect(TRASH_ROW).toContain('iconKey="history"');
  });

  it("'history' is a real SidebarIconKey with its own non-trash path set", () => {
    const union = /type SidebarIconKey =([\s\S]*?);/.exec(sidebar);
    expect(union).not.toBeNull();
    expect(union![1]).toContain("'history'");
    // QUICK_ICON_PATHS must define it — an undefined lookup would crash the
    // icon map at render time.
    const paths = /const QUICK_ICON_PATHS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(
      sidebar,
    );
    expect(paths).not.toBeNull();
    const history = /history:\s*\[([\s\S]*?)\]/.exec(paths![1]);
    const trash = /trash:\s*\[([\s\S]*?)\]/.exec(paths![1]);
    expect(history, 'QUICK_ICON_PATHS.history').not.toBeNull();
    expect(trash, 'QUICK_ICON_PATHS.trash').not.toBeNull();
    expect(history![1]).not.toBe(trash![1]);
    // A clock reads as a circle plus hands — never the bin silhouette.
    expect(history![1]).toContain('a10 10');
    expect(history![1]).toContain('v6l4 2');
  });
});

describe('P402 · the two controls sit ≥50px apart', () => {
  it('.recent-chat-trash declares a margin-top of at least 16px', () => {
    const body = ruleBody(sidebarCssDecl, '.recent-chat-trash');
    expect(body).toBeTruthy();
    const margin = /margin-top:\s*(\d+)px/.exec(body);
    expect(margin, '.recent-chat-trash needs margin-top ≥ 16px').not.toBeNull();
    expect(Number(margin![1])).toBeGreaterThanOrEqual(16);
  });

  it('clear-all height + the gap clears the 50px separation budget', () => {
    // At the 390px floor the mobile block pins .recent-chat-clear-all to a
    // 36px touch target; the gap above the 回收站 row then yields
    // 36 + margin ≥ 50px between the two button tops.
    const mobile = /@media \(max-width: 768px\)([\s\S]*)/.exec(sidebarCssDecl);
    expect(mobile).not.toBeNull();
    const clearAll = ruleBody(mobile![1], '.recent-chat-clear-all');
    expect(clearAll).toContain('min-height: 36px');
    const trashBody = ruleBody(sidebarCssDecl, '.recent-chat-trash');
    const gap = Number(/margin-top:\s*(\d+)px/.exec(trashBody)![1]);
    expect(36 + gap).toBeGreaterThanOrEqual(50);
  });

  it('the separation is vertical margin — no absolute positioning tricks', () => {
    const body = ruleBody(sidebarCssDecl, '.recent-chat-trash');
    expect(body).not.toContain('position: absolute');
    expect(body).not.toContain('position: fixed');
    // Still a transparent navigation row (P378), never a danger-styled twin.
    expect(body).toContain('background: transparent');
    expect(body).toContain('border: none');
  });
});
