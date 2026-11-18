/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Sidebar from '../src/components/Sidebar';

/**
 * P298 — at 390×844 the open drawer overflowed its own scroll container by
 * ~52px (measured aside.scrollHeight 896 / clientHeight 844): the last
 * 进阶工具 item rendered behind the sticky footer with nothing signalling
 * the area scrolled. The content between the drawer chrome and the 设置
 * footer now lives in a dedicated .sidebar-body scroll region
 * (flex:1 1 auto; min-height:0; overflow-y:auto) — the <aside> itself never
 * overflows, the footer is a pinned flex sibling outside the scrolling list,
 * and the drawer-only gap/padding tightening lets a fresh sidebar fit all
 * five tool items at rest. Source-level + static-markup assertions in the
 * style of sidebar-settings-reachable.test.ts (P201).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

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

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

const tsx = read('components/Sidebar.tsx');
const css = read('components/Sidebar.css');
const mobile = mediaBlock(css, '(max-width: 768px)');

const noop = () => {};

function renderSidebar() {
  return renderToStaticMarkup(
    createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
  );
}

describe('P298 · dedicated scroll region inside the sidebar', () => {
  it('renders a .sidebar-body element wrapping the whole list before the footer', () => {
    const html = renderSidebar();
    const bodyAt = html.indexOf('sidebar-body');
    const footerAt = html.indexOf('sidebar-footer');
    expect(bodyAt).toBeGreaterThanOrEqual(0);
    expect(footerAt).toBeGreaterThan(bodyAt);
    // The scroll region wraps the whole list: new-chat, all sections, tools.
    const body = html.slice(bodyAt, footerAt);
    expect(body).toContain('new-chat-btn');
    expect(body).toContain('aria-label="最近对话"');
    expect(body).toContain('aria-label="快捷入口"');
    expect(body).toContain('aria-label="进阶工具"');
    expect(body).toContain('tool-list');
    // …and it closes immediately before the footer element opens, so the
    // 设置 footer is a flex sibling of — not a child of — the scroll region.
    expect(html.slice(0, html.indexOf('<footer'))).toMatch(/<\/div>\s*$/);
  });

  it('keeps the 设置 footer outside the scrolling list region', () => {
    const html = renderSidebar();
    const footerAt = html.indexOf('sidebar-footer');
    const bodyOpen = html.indexOf('class="sidebar-body"');
    // The last </div> before <footer> is .sidebar-body's own closing tag.
    const bodyClose = html.lastIndexOf('</div>', footerAt);
    expect(bodyOpen).toBeGreaterThanOrEqual(0);
    expect(bodyClose).toBeGreaterThan(bodyOpen);
    expect(bodyClose).toBeLessThan(footerAt);
    expect(
      html.slice(bodyOpen, bodyClose).includes('settings-open-btn'),
    ).toBe(false);
    // …and the footer is still the last child of the <aside>.
    const tail = html.slice(html.indexOf('</footer>'));
    expect(tail.replace(/\s/g, '')).toMatch(/^<\/footer><\/aside>$/);
  });

  it('gives .sidebar-body the flex sizing that actually lets it scroll', () => {
    const body = ruleBody(css, '.sidebar-body');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('flex: 1 1 auto');
  });

  it('lays the region out as a column flex box matching the old aside spacing', () => {
    const body = ruleBody(css, '.sidebar-body');
    expect(body).toContain('display: flex');
    expect(body).toContain('flex-direction: column');
    expect(body).toContain('gap: 20px');
  });
});

describe('P298 · mobile drawer wiring stays intact', () => {
  it('keeps the drawer itself non-clipping-safe and the footer pinned', () => {
    // The aside still may scroll as a fallback, but with the body region
    // constrained it reports scrollHeight <= clientHeight at 390×844.
    expect(ruleBody(mobile, '.sidebar.sidebar-drawer')).toContain(
      'overflow-y: auto',
    );
    const footer = ruleBody(mobile, '.sidebar.sidebar-drawer .sidebar-footer');
    expect(footer).toContain('position: sticky');
    expect(footer).toContain('bottom: 0');
    expect(footer).toContain('background: var(--surface)');
  });

  it('tightens drawer-only spacing so all five tool items fit at 390×844', () => {
    // Only inside the ≤768px block — desktop keeps the 20px rhythm.
    expect(ruleBody(mobile, '.sidebar.sidebar-drawer')).toContain('gap: 12px');
    expect(
      ruleBody(mobile, '.sidebar.sidebar-drawer .sidebar-body'),
    ).toContain('gap: 12px');
    expect(ruleBody(css, '.sidebar-body')).toContain('gap: 20px');
  });

  it('does not let the trash sheet live inside the scroll region', () => {
    // TrashSheet is position:fixed — inside .sidebar-body it would be clipped
    // by overflow-y:auto, so it must stay a direct child of the <aside>,
    // between the body's </div> and the footer.
    const trashAt = tsx.indexOf('<TrashSheet');
    const bodyClose = tsx.lastIndexOf('</div>', trashAt);
    const bodyOpen = tsx.indexOf('className="sidebar-body"');
    expect(bodyOpen).toBeGreaterThanOrEqual(0);
    expect(trashAt).toBeGreaterThan(bodyClose);
    expect(bodyClose).toBeGreaterThan(bodyOpen);
    const footerAt = tsx.indexOf('<footer className="sidebar-footer"');
    expect(trashAt).toBeLessThan(footerAt);
  });
});
