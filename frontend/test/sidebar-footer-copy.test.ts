/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Sidebar from '../src/components/Sidebar';

/**
 * P223 — the drawer footer used to close with 「基于 Agent Harness 架构」 and
 * 「Tool-calling · SSE · TypeScript」, framework jargon meaningless to a
 * dating user and the last thing they saw in the drawer. The footer now
 * holds only the 设置 entry. These guards pin the rendered markup: no tech
 * jargon anywhere in the sidebar output, and the drawer controls (quick
 * entries, tool items, settings trigger) keep their counts and labels.
 */

const noop = () => {};

function renderSidebar() {
  return renderToStaticMarkup(
    createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
  );
}

const JARGON = ['Tool-calling', 'SSE', 'TypeScript', 'Agent Harness'];

describe('P223 · sidebar footer copy carries no architecture jargon', () => {
  it('renders none of the jargon strings anywhere in the sidebar markup', () => {
    const html = renderSidebar();
    for (const word of JARGON) {
      expect(html).not.toContain(word);
    }
  });

  it('leaves no jargon in the sidebar source either', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'src',
        'components',
        'Sidebar.tsx',
      ),
      'utf8',
    );
    for (const word of JARGON) {
      expect(src).not.toContain(word);
    }
  });

  it('keeps the four quick-entry buttons with their aria-labels', () => {
    const html = renderSidebar();
    const labels = [...html.matchAll(/aria-label="快捷提问：([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual([
      '帮我优化资料',
      '她这样回我怎么接',
      '帮我规划第一次约会',
      '我们合不合适',
    ]);
  });

  it('keeps the five 进阶工具 fallback items unchanged', () => {
    const html = renderSidebar();
    const items = [...html.matchAll(/class="tool-item">([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(items).toEqual([
      '改资料',
      '接话术',
      '排约会',
      '看匹配',
      '关系建议',
    ]);
  });

  it('keeps the settings trigger inside the footer with its aria-label', () => {
    const html = renderSidebar();
    const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
    expect(footer).toContain('settings-open-btn');
    expect(footer).toContain('aria-label="设置"');
  });
});
