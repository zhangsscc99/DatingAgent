/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Sidebar from '../src/components/Sidebar';
import { toolDisplayName, TOOL_LABELS } from '../src/lib/toolLabels';

/**
 * P285 — the third drawer section was titled 「Agent 工具」, the only
 * all-caps English token in an otherwise fully Chinese UI, and its five
 * entries reused internal module names (资料优化 / 聊天指导 / 约会规划 /
 * 匹配分析 / 关系建议). The heading is now 「进阶工具」 and the labels are
 * user-facing noun phrases served from the single TOOL_LABELS map. These
 * guards pin the rendered heading set, ban all-caps English words from
 * section titles and tool labels, and lock the id → label contract.
 */

const noop = () => {};
const ALL_CAPS_ENGLISH = /\b[A-Z]{2,}\b/;

function renderSidebar() {
  return renderToStaticMarkup(
    createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
  );
}

describe('P285 · sidebar section titles carry no all-caps English', () => {
  it('renders the expected set of section headings', () => {
    const html = renderSidebar();
    const headings = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(['最近对话', '快捷入口', '进阶工具']);
  });

  it('every section heading aria-label matches its visible text', () => {
    const html = renderSidebar();
    const ariaLabels = [
      ...html.matchAll(/<section[^>]*aria-label="([^"]+)"/g),
    ].map((m) => m[1]);
    const headings = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(
      (m) => m[1],
    );
    expect(ariaLabels.length).toBeGreaterThanOrEqual(3);
    for (const aria of ariaLabels) {
      expect(headings).toContain(aria);
    }
  });

  it('no section heading contains an all-caps English token', () => {
    const html = renderSidebar();
    const headings = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map(
      (m) => m[1],
    );
    for (const heading of headings) {
      expect(ALL_CAPS_ENGLISH.test(heading)).toBe(false);
    }
  });

  it('the five tool entries show the new labels, in order', () => {
    const html = renderSidebar();
    // P316: each .tool-item li wraps a real .tool-entry button — the label
    // is the button's text content (P358: icon/chevron markup stripped).
    const items = [
      ...html.matchAll(/<button[^>]*class="tool-entry"[^>]*>([\s\S]*?)<\/button>/g),
    ].map((m) => m[1].replace(/<[^>]+>/g, ''));
    expect(items).toEqual(['改资料', '接话术', '排约会', '看匹配', '关系建议']);
  });

  it('toolDisplayName maps every known id to the user-facing phrase', () => {
    expect(toolDisplayName('analyze_profile')).toBe('改资料');
    expect(toolDisplayName('coach_conversation')).toBe('接话术');
    expect(toolDisplayName('plan_date')).toBe('排约会');
    expect(toolDisplayName('check_compatibility')).toBe('看匹配');
    expect(toolDisplayName('get_relationship_advice')).toBe('关系建议');
    expect(toolDisplayName('mystery_backend_tool')).toBeUndefined();
  });

  it('no tool label is an all-caps English token or a raw tool id', () => {
    for (const [id, label] of Object.entries(TOOL_LABELS)) {
      expect(ALL_CAPS_ENGLISH.test(label)).toBe(false);
      expect(label).not.toBe(id);
    }
  });
});
