/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sidebar from '../src/components/Sidebar';
import { STARTER_ENTRIES } from '../src/lib/starterEntries';
import { TOOL_FALLBACK } from '../src/components/Sidebar';
import { toolDisplayName } from '../src/lib/toolLabels';

/**
 * P358 — sidebar control-language unification. The 390×844 + 1440×900
 * walkthrough found two control languages at the same hierarchy level: the
 * 快捷入口 rendered four white rounded button cards while the 进阶工具
 * rendered five bare text rows, with an orphaned dashed rule and dead space
 * under them (vision: "看起来像某个折叠面板没有完整展示"). The 回收站 row
 * and the no-profile 完善资料 entry also carried dashed outlines, and the
 * drawer close button wore a double ring that competed with 「+ 新对话」.
 *
 * The fix renders both groups as one row anatomy — leading icon, primary
 * label, right-edge chevron — sharing the exact same .quick-btn/.tool-entry
 * rule (radius, padding, 44px min-height, hover ring), removes every
 * `border-style: dashed` inside .sidebar, drops the close button to a
 * single outline layer, and leaves the .sidebar-footer top border as the
 * only unlabelled rule in the drawer.
 *
 * jsdom caveat honoured: this suite runs on the repo's node/fake-DOM
 * harness where external stylesheets never resolve computed styles, so the
 * assertions pin the STRUCTURAL + TOKEN contract instead — both groups
 * share the same `data-control="row"` marker and the same CSS declaration
 * block (a literal `.quick-btn, .tool-entry { … }` rule holds one
 * border-radius/padding/min-height), which is stronger than a computed-
 * style read: divergence cannot even be declared.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const sidebarTsx = read('components/Sidebar.tsx');
const sidebarCss = read('components/Sidebar.css');
// Declarations only — comments may legitimately *mention* "dashed" (they
// document what was removed); the contract applies to live rules.
const sidebarCssDecl = sidebarCss.replace(/\/\*[\s\S]*?\*\//g, '');

const noop = () => {};

const EXPECTED_TOOL_LABELS = TOOL_FALLBACK.map(
  (t) => toolDisplayName(t.name) ?? t.label,
);

function renderSidebar(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(Sidebar, {
      tools: TOOL_FALLBACK,
      onQuickPrompt: noop,
      onNewChat: noop,
      ...props,
    }),
  );
}

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

/** Slice the body of `@media <query> { … }` with brace matching. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return '';
}

/** Every `selector-list { body }` rule in a stylesheet (media blocks
 * included — the regex simply treats them as nested text). */
function allRules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1],
    body: m[2],
  }));
}

/** True when the rule's selector list contains the class as a whole token
 * (`.tool-entry` but never `.tool-entry-skeleton`). */
function selectorHits(selector: string, cls: string): boolean {
  const token = new RegExp(`\\.${cls}(?![-\\w])`);
  return selector.split(',').some((part) => token.test(part));
}

/** First `prop: value` declaration in a rule body, or null. */
function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m ? m[2].trim() : null;
}

describe('P358 · both entry groups share one row anatomy', () => {
  it('renders ≥4 rows per group, every row marked data-control="row"', () => {
    const html = renderSidebar();
    const quick = [...html.matchAll(/<button[^>]*class="quick-btn"[^>]*>/g)];
    const tools = [
      ...html.matchAll(/<button[^>]*class="tool-entry"[^>]*>/g),
    ];
    expect(quick.length).toBeGreaterThanOrEqual(4);
    expect(tools.length).toBeGreaterThanOrEqual(4);
    for (const [tag] of [...quick, ...tools]) {
      expect(tag).toContain('data-control="row"');
    }
  });

  it('every 进阶工具 row carries icon + label + chevron and a 进阶工具： name', () => {
    const html = renderSidebar();
    const section = /<section[^>]*aria-label="进阶工具"[\s\S]*?<\/section>/.exec(
      html,
    )?.[0];
    expect(section).toBeTruthy();
    const rows = [
      ...section!.matchAll(
        /<button[^>]*aria-label="(进阶工具：[^"]*)"[^>]*>([\s\S]*?)<\/button>/g,
      ),
    ];
    expect(rows.length).toBe(EXPECTED_TOOL_LABELS.length);
    for (const [, name, inner] of rows) {
      expect(name.startsWith('进阶工具：')).toBe(true);
      // Leading icon and right-edge chevron — same anatomy as .quick-btn.
      expect(inner).toContain('class="sidebar-icon"');
      expect(inner).toContain('class="sidebar-chevron"');
      expect(inner).toContain('class="sidebar-row-label"');
    }
  });

  it('the skeleton state paints the same row anatomy — no layout shift on hydrate', () => {
    const html = renderSidebar({ tools: [], toolsLoading: true });
    const rows = [
      ...html.matchAll(
        /<button[^>]*aria-label="(进阶工具：[^"]*)"[^>]*>([\s\S]*?)<\/button>/g,
      ),
    ];
    expect(rows.length).toBe(EXPECTED_TOOL_LABELS.length);
    for (const [, , inner] of rows) {
      expect(inner).toContain('class="sidebar-icon"');
      expect(inner).toContain('class="sidebar-chevron"');
      expect(inner).toContain('class="sidebar-row-label"');
    }
    // P322 contract kept: skeleton rows stay disabled + busy.
    expect(html.match(/aria-busy="true"/g)?.length).toBe(
      EXPECTED_TOOL_LABELS.length,
    );
  });

  it('quick rows carry the same anatomy — icon, label span, chevron', () => {
    const html = renderSidebar();
    const rows = [
      ...html.matchAll(
        /<button[^>]*class="quick-btn"[^>]*aria-label="(快捷提问：[^"]*)"[^>]*>([\s\S]*?)<\/button>/g,
      ),
    ];
    expect(rows.length).toBe(STARTER_ENTRIES.length);
    for (const [, , inner] of rows) {
      expect(inner).toContain('class="sidebar-icon"');
      expect(inner).toContain('class="sidebar-chevron"');
      expect(inner).toContain('class="sidebar-row-label"');
    }
  });
});

describe('P358 · one token set across both groups (≤2 style variants)', () => {
  const PROPS = ['border-radius', 'padding', 'min-height', 'font-size'];

  it('a single shared rule declares the box for .quick-btn and .tool-entry', () => {
    const shared = allRules(sidebarCssDecl).find(
      (r) =>
        selectorHits(r.selector, 'quick-btn') &&
        selectorHits(r.selector, 'tool-entry') &&
        !r.selector.includes(':'),
    );
    expect(shared, 'shared .quick-btn, .tool-entry rule').toBeTruthy();
    for (const prop of PROPS) {
      expect(decl(shared!.body, prop), prop).not.toBeNull();
    }
    expect(decl(shared!.body, 'min-height')).toBe('44px');
    // P378: the per-item描边卡片 is gone — the shared row is a borderless
    // list line; only :hover/:focus paints a fill underneath.
    expect(shared!.body).toContain('border: none');
    expect(shared!.body).toContain('background');
  });

  it('no rule anywhere gives either class a divergent radius/padding/min-height', () => {
    for (const prop of ['border-radius', 'padding', 'min-height']) {
      const values = new Set<string>();
      for (const cls of ['quick-btn', 'tool-entry']) {
        for (const r of allRules(sidebarCssDecl)) {
          if (!selectorHits(r.selector, cls)) continue;
          const v = decl(r.body, prop);
          if (v) values.add(v);
        }
      }
      expect(
        values.size,
        `${prop} variants across .quick-btn/.tool-entry: ${[...values].join(', ')}`,
      ).toBeLessThanOrEqual(2);
    }
    // And the mobile block keeps the 44px touch target for both classes.
    const mobile = mediaBlock(sidebarCssDecl, '(max-width: 768px)');
    const mobileShared = allRules(mobile).find(
      (r) =>
        selectorHits(r.selector, 'quick-btn') &&
        selectorHits(r.selector, 'tool-entry'),
    );
    expect(mobileShared).toBeTruthy();
    expect(decl(mobileShared!.body, 'min-height')).toBe('44px');
  });

  it('the shared hover rule gives both groups the same affordance', () => {
    const hover = allRules(sidebarCssDecl).find(
      (r) =>
        selectorHits(r.selector, 'quick-btn') &&
        selectorHits(r.selector, 'tool-entry') &&
        r.selector.includes(':hover'),
    );
    expect(hover).toBeTruthy();
    expect(hover!.body).toContain('var(--surface-hover)');
  });
});

describe('P358 · no dashed borders, no orphan divider inside .sidebar', () => {
  it('Sidebar.css declares no dashed border anywhere in the sidebar scope', () => {
    expect(sidebarCssDecl).not.toContain('dashed');
    expect(sidebarCssDecl).not.toContain('dotted');
    // P378: the 回收站 row dropped its fill (it read as a twin of the old
    // filter bar); the 完善资料 entry keeps its single accent-soft layer.
    expect(ruleBody(sidebarCssDecl, '.recent-chat-trash')).toContain(
      'background: transparent',
    );
    expect(ruleBody(sidebarCssDecl, '.recent-chat-trash')).toContain(
      'border: none',
    );
    expect(ruleBody(sidebarCssDecl, '.profile-setup-btn')).toContain(
      'background: var(--accent-soft)',
    );
  });

  it('renders no <hr> or unlabelled separator — only the footer top rule remains', () => {
    for (const props of [
      {},
      { tools: [], toolsLoading: true },
      { isMobile: true, open: true },
    ]) {
      const html = renderSidebar(props);
      expect(html).not.toContain('<hr');
      expect(html).not.toContain('role="separator"');
    }
    // The one rule the spec allows: .sidebar-footer's own 1px top border.
    expect(ruleBody(sidebarCssDecl, '.sidebar-footer')).toContain(
      'border-top: 1px solid var(--border)',
    );
    // …and no element class carries a divider/separator name.
    expect(sidebarTsx).not.toMatch(/divider|separator|<hr/i);
  });

  it('the drawer close button drops to a single outline layer', () => {
    const mobile = mediaBlock(sidebarCssDecl, '(max-width: 768px)');
    const close = ruleBody(mobile, '.sidebar-close-btn');
    expect(close).toBeTruthy();
    // box-shadow layer count ≤ 1 — here zero — and no border ring left to
    // stack under the focus outline.
    expect(close).not.toContain('box-shadow');
    expect(close).toContain('border: none');
    const focus = ruleBody(mobile, '.sidebar-close-btn:focus-visible');
    expect(focus).toContain('outline');
  });
});
