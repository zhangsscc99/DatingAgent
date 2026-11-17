/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P208 — header emoji-free contract. The header action row was the last
 * surface still rendering emoji/glyph icons (🌐 lang icon, ☾/☀ theme icon,
 * ⬇/⧉ export-copy icons, and the floating 🔍 search toggle in
 * ChatWindow). vitest runs in node (no DOM renderer), so these are source
 * guards on App.tsx/ChatWindow.tsx plus a static render of ChatWindow:
 * no Extended_Pictographic code points in the header markup, inline
 * currentColor-stroke SVGs replacing the glyphs, and every action's
 * accessible name unchanged.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const app = read('App.tsx');
const chat = read('components/ChatWindow.tsx');
const EMOJI = /\p{Extended_Pictographic}/u;

const headerStart = app.indexOf('className="header-actions"');
const headerActions = app.slice(headerStart, app.indexOf('</header>', headerStart));

// P226: the only search toggle left is the header one — the floating
// .search-toggle inside .messages-wrap is gone at every width.
const toggleAt = app.indexOf('className="search-toggle-header"');
const searchToggle = app.slice(toggleAt, app.indexOf('</button>', toggleAt));

const MESSAGES: ChatMessage[] = [
  { id: 'u-1', role: 'user', content: '她今天答应周末出来了', createdAt: 1 },
];

describe('P208 · header action row has no emoji glyphs', () => {
  it('the header-actions block contains no emoji code points', () => {
    expect(headerStart).toBeGreaterThan(-1);
    expect(headerActions).not.toMatch(EMOJI);
  });

  it('the header search toggle renders an inline SVG, not a glyph', () => {
    expect(toggleAt).toBeGreaterThan(-1);
    expect(searchToggle).not.toMatch(EMOJI);
    expect(searchToggle).toContain('<svg');
    expect(searchToggle).toContain('stroke="currentColor"');
    expect(searchToggle).toContain('aria-hidden="true"');
  });

  it('the chat window no longer renders a floating search toggle', () => {
    const html = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: MESSAGES,
        loading: false,
        onSend: () => {},
      }),
    );
    // P226: the floating .search-toggle inside .messages-wrap was removed;
    // the trigger lives in the header at every width.
    expect(html).not.toContain('search-toggle');
    expect(chat).not.toContain('className="search-toggle"');
  });

  it('each header icon container mounts an aria-hidden currentColor SVG', () => {
    for (const cls of ['lang-select-icon', 'theme-icon', 'search-toggle-header']) {
      const at = headerActions.indexOf(cls);
      expect(at, cls).toBeGreaterThan(-1);
      const block = headerActions.slice(at, at + 2600);
      expect(block, cls).toContain('<svg');
      expect(block, cls).toContain('stroke="currentColor"');
      expect(block, cls).not.toMatch(EMOJI);
    }
    // The three export/copy buttons swap their ⬇/⧉ glyphs for SVGs inside .btn-icon.
    const iconSpans = headerActions.match(/className="btn-icon"/g) ?? [];
    expect(iconSpans.length).toBe(3);
    const svgCount = headerActions.match(/<svg/g) ?? [];
    expect(svgCount.length).toBeGreaterThanOrEqual(5); // lang + theme + search + 2×download/copy at idle
  });

  it('every header action keeps its accessible name', () => {
    expect(headerActions).toContain('aria-label="回复语言"');
    expect(headerActions).toContain('aria-label={FIND_IN_CONVERSATION_LABEL}');
    expect(headerActions).toContain("'导出 Markdown'");
    expect(headerActions).toContain("'导出 JSON'");
    expect(headerActions).toContain("'复制 Markdown'");
    expect(headerActions).toContain('切换到浅色主题');
    expect(headerActions).toContain('切换到深色主题');
    // Tooltips that carried meaning are untouched.
    expect(headerActions).toContain('title="选择回复语言（自动跟随对话）"');
    expect(headerActions).toContain('title={FIND_IN_CONVERSATION_LABEL}');
    // The search toggle keeps its name too.
    expect(searchToggle).toContain('aria-label={FIND_IN_CONVERSATION_LABEL}');
    expect(searchToggle).toContain('title={FIND_IN_CONVERSATION_LABEL}');
    expect(searchToggle).toContain('chatWindowRef.current?.openSearch()');
  });

  it('the done state still shows a plain check, not an emoji', () => {
    expect(headerActions).toContain("'✓'");
  });
});
