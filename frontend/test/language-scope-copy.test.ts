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
 * P213 — the 「语言」 switch only changes the AI reply language, but its label
 * read like an interface-language switch: flipping to English left every
 * visible string Chinese, so the control looked broken. The section is now
 * labelled 「回复语言」 with a dim helper line stating the interface stays
 * Chinese, and the header <select> tooltip uses the same wording.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

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

describe('P213 · reply-language scope copy', () => {
  it('labels the section 「回复语言」, not 「语言」', () => {
    const html = renderSheet('zh');
    expect(html).toContain('aria-label="回复语言"');
    expect(html).toContain('<h3>回复语言</h3>');
    expect(html).not.toContain('<h3>语言</h3>');
  });

  it('shows the Chinese helper line for zh and auto', () => {
    for (const lang of ['zh', 'auto'] as ReplyLanguage[]) {
      const html = renderSheet(lang);
      expect(html).toContain('settings-lang-note');
      expect(html).toContain('只影响 AI 回复的语言，界面保持中文。');
    }
  });

  it('shows the English helper line for en', () => {
    const html = renderSheet('en');
    expect(html).toContain('settings-lang-note');
    expect(html).toContain(
      'Reply language only — the interface stays in Chinese.',
    );
  });

  it('header select title/aria-label carries 「回复语言」', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    const start = app.indexOf('className="lang-select-input"');
    expect(start).toBeGreaterThan(-1);
    const select = app.slice(start, app.indexOf('</select>', start));
    expect(select).toContain('aria-label="回复语言"');
    expect(select).toMatch(/title="[^"]*回复语言[^"]*"/);
  });
});
