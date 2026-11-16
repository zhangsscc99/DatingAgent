/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import SettingsSheet from '../src/components/SettingsSheet';
import type { ReplyLanguage } from '../src/types';

/**
 * P211 — the language segmented control had no `auto` option, so with the
 * stored default (`'auto'`) no segment matched: zero `active` classes and
 * zero `aria-pressed="true"` on the 语言 row. Each group must now expose
 * exactly one pressed segment whose label matches the current value.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const noop = () => {};

function renderSheet(language: ReplyLanguage) {
  return renderToStaticMarkup(
    createElement(SettingsSheet, {
      open: true,
      onClose: noop,
      replyLength: 'default',
      onReplyLengthChange: noop,
      language,
      onLanguageChange: noop,
      theme: 'light',
      onThemeChange: noop,
      canExport: false,
      hasSessions: false,
      onExportMarkdown: noop,
      onExportJson: noop,
      onClearAll: noop,
    }),
  );
}

/** Extract the segmented group markup for a given aria-label. */
function groupMarkup(html: string, label: string): string {
  const marker = `role="group" aria-label="${label}"`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start));
}

/** Labels of segments marked pressed inside a group, in render order. */
function pressedLabels(group: string): string[] {
  const labels: string[] = [];
  for (const m of group.matchAll(/aria-pressed="true" aria-label="([^"]+)"/g)) {
    labels.push(m[1]);
  }
  return labels;
}

describe('P211 · settings segmented a11y state', () => {
  it('语言 selects 自动 when language is auto', () => {
    const group = groupMarkup(renderSheet('auto'), '回复语言');
    expect(pressedLabels(group)).toEqual(['自动']);
    expect(group).toContain('aria-pressed="false" aria-label="中文"');
    expect(group).toContain('aria-pressed="false" aria-label="English"');
    expect(group).toContain('settings-segment active');
  });

  it('回复长度偏好 and 主题 each select exactly one segment', () => {
    const html = renderSheet('auto');
    expect(pressedLabels(groupMarkup(html, '回复长度偏好'))).toEqual(['默认']);
    expect(pressedLabels(groupMarkup(html, '主题'))).toEqual(['浅色']);
  });

  it('selection moves to English when language is en', () => {
    const group = groupMarkup(renderSheet('en'), '回复语言');
    expect(pressedLabels(group)).toEqual(['English']);
    expect(group).toContain('aria-pressed="false" aria-label="自动"');
    expect(group).toContain('aria-pressed="false" aria-label="中文"');
  });

  it('LANGUAGE_OPTIONS covers auto, zh, en with auto first', () => {
    const src = read('components/SettingsSheet.tsx');
    const block = src.match(/LANGUAGE_OPTIONS[\s\S]*?\];/);
    expect(block).not.toBeNull();
    const text = block![0];
    for (const value of ['auto', 'zh', 'en']) {
      expect(text).toContain(`value: '${value}'`);
    }
    expect(text.indexOf("value: 'auto'")).toBeLessThan(text.indexOf("value: 'zh'"));
    expect(text.indexOf("value: 'zh'")).toBeLessThan(text.indexOf("value: 'en'"));
  });
});
