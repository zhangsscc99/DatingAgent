/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ChatSearchBar from '../src/components/ChatSearchBar';
import {
  FIND_IN_CONVERSATION_LABEL,
  FIND_IN_CONVERSATION_PLACEHOLDER,
  FILTER_SESSIONS_HINT,
  FILTER_SESSIONS_LABEL,
} from '../src/lib/searchLabels';

/**
 * P271 — the two history-adjacent entries used to share the same 搜索/筛选
 * wording: the header find button read 搜索对话/搜索当前对话 (but only jumps
 * inside the open conversation) while the sidebar input read 筛选对话 (but
 * only matches recent titles). The find entry is renamed 在本对话内查找 at
 * every render site, and the sidebar empty state gains a muted 只筛选最近
 * 对话标题 scope line. Both string sets come from lib/searchLabels.ts — no
 * duplicated literals in components.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const appTsx = read('App.tsx');
const searchBarTsx = read('components/ChatSearchBar.tsx');
const sidebarTsx = read('components/Sidebar.tsx');
const sidebarCss = read('components/Sidebar.css');

describe('P271 · find-in-conversation vs session-filter labels', () => {
  it('the two entries carry different names', () => {
    expect(FIND_IN_CONVERSATION_LABEL).not.toBe(FILTER_SESSIONS_LABEL);
    expect(FIND_IN_CONVERSATION_PLACEHOLDER).not.toBe(FILTER_SESSIONS_LABEL);
  });

  it('the in-conversation find label says 本对话内', () => {
    expect(FIND_IN_CONVERSATION_LABEL).toContain('本对话内');
    expect(FIND_IN_CONVERSATION_PLACEHOLDER).toContain('本对话内');
  });

  it('the sidebar filter keeps 筛选 and the hint honestly scopes it to 标题 + 内容', () => {
    expect(FILTER_SESSIONS_LABEL).toContain('筛选');
    expect(FILTER_SESSIONS_HINT).toContain('标题');
    expect(FILTER_SESSIONS_HINT).toContain('内容');
  });

  it('every render site imports the shared constants — no duplicated literals', () => {
    // Header trigger in App.tsx.
    expect(appTsx).toContain("from './lib/searchLabels'");
    expect(appTsx).toContain('aria-label={FIND_IN_CONVERSATION_LABEL}');
    expect(appTsx).toContain('title={FIND_IN_CONVERSATION_LABEL}');
    // Find bar input + buttons.
    expect(searchBarTsx).toContain("from '../lib/searchLabels'");
    expect(searchBarTsx).toContain('placeholder={FIND_IN_CONVERSATION_PLACEHOLDER}');
    expect(searchBarTsx).toContain('aria-label={FIND_IN_CONVERSATION_LABEL}');
    // Sidebar filter input + empty-state scope line.
    expect(sidebarTsx).toContain("from '../lib/searchLabels'");
    expect(sidebarTsx).toContain('aria-label={FILTER_SESSIONS_LABEL}');
    expect(sidebarTsx).toContain('placeholder={FILTER_SESSIONS_LABEL}');
    expect(sidebarTsx).toContain('{FILTER_SESSIONS_HINT}');
    // The old wording is gone from component source entirely.
    for (const src of [appTsx, searchBarTsx, sidebarTsx]) {
      expect(src).not.toContain('搜索对话');
      expect(src).not.toContain('搜索当前对话');
      expect(src).not.toContain('"筛选对话"');
    }
  });

  it('the rendered find bar exposes the new label on input and close button', () => {
    const html = renderToStaticMarkup(
      createElement(ChatSearchBar, {
        query: '',
        matchCount: 0,
        activeIndex: 0,
        onQueryChange: () => {},
        onNext: () => {},
        onPrev: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(`placeholder="${FIND_IN_CONVERSATION_PLACEHOLDER}"`);
    expect(html).toContain(`aria-label="${FIND_IN_CONVERSATION_LABEL}"`);
    expect(html).not.toContain('搜索');
  });

  it('the filter empty state folds the scope note into the first sentence, before the button', () => {
    const hintAt = sidebarTsx.indexOf('filter-empty-hint');
    const li = sidebarTsx.slice(hintAt, sidebarTsx.indexOf('</li>', hintAt));
    // P275: 提示 → 说明 → 清除筛选 — the scope note is read before the action.
    expect(li.indexOf('filter-empty-hint-text')).toBeLessThan(
      li.indexOf('filter-empty-hint-scope'),
    );
    expect(li.indexOf('filter-empty-hint-scope')).toBeLessThan(
      li.indexOf('filter-empty-clear'),
    );
    expect(sidebarCss).toContain('.filter-empty-hint-scope');
  });
});
