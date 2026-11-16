/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InputBar from '../src/components/InputBar';
import SettingsSheet from '../src/components/SettingsSheet';
import { buildChatRequestBody } from '../src/lib/chatRequest';
import {
  REPLY_LENGTH_STORAGE_KEY,
  nextReplyLengthPreference,
  readReplyLengthPreference,
  replyLengthRequestField,
  replyLengthToggleAriaLabel,
  writeReplyLengthPreference,
} from '../src/lib/replyLength';

/**
 * P205 — in-place「回复长度」cycler on the composer tool row. The preference
 * used to live only inside the settings sheet, so a mid-conversation「给我
 * 短一点的」meant opening settings first. The toggle shares the exact same
 * storage key and the exact same App-level setter, so the two controls can
 * never disagree.
 *
 * Vitest runs in node: markup assertions go through renderToStaticMarkup
 * (the click path is exercised through the same pure helpers the onClick
 * handler delegates to, pinned by source-level wiring asserts), and storage
 * uses an in-memory localStorage stub.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const noop = () => {};

const sheetProps = {
  onClose: noop,
  language: 'auto' as const,
  onLanguageChange: noop,
  theme: 'light' as const,
  onThemeChange: noop,
  canExport: false,
  hasSessions: false,
  onExportMarkdown: noop,
  onExportJson: noop,
  onClearAll: noop,
};

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

function renderBar(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(InputBar, {
      onSend: noop,
      replyLength: 'default' as const,
      onReplyLengthChange: noop,
      ...extra,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P205 · composer reply-length toggle', () => {
  describe('control', () => {
    it('renders in the composer tool row with the current 档位 in its name', () => {
      const html = renderBar({ replyLength: 'default' });
      expect(html).toContain('reply-length-toggle');
      expect(html).toContain('aria-label="回复长度：默认，点击切换为精简"');
      // It sits on the same flex row as the ⌨ hint button, before it.
      expect(html.indexOf('reply-length-toggle')).toBeLessThan(
        html.indexOf('input-hint-btn'),
      );
    });

    it('names the click outcome for every 档位', () => {
      expect(replyLengthToggleAriaLabel('default')).toBe(
        '回复长度：默认，点击切换为精简',
      );
      expect(replyLengthToggleAriaLabel('concise')).toBe(
        '回复长度：精简，点击切换为详细',
      );
      expect(replyLengthToggleAriaLabel('detailed')).toBe(
        '回复长度：详细，点击切换为默认',
      );
      const html = renderBar({ replyLength: 'detailed' });
      expect(html).toContain('aria-label="回复长度：详细，点击切换为默认"');
    });

    it('carries no emoji glyphs, only text', () => {
      const html = renderBar();
      const btn = html.slice(
        html.indexOf('reply-length-toggle'),
        html.indexOf('input-hint'),
      );
      expect(btn).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });

  describe('click cycle → storage', () => {
    it('cycles 默认 → 精简 → 详细 → 默认', () => {
      expect(nextReplyLengthPreference('default')).toBe('concise');
      expect(nextReplyLengthPreference('concise')).toBe('detailed');
      expect(nextReplyLengthPreference('detailed')).toBe('default');
    });

    it('the onClick handler sends the next 档位 through onReplyLengthChange', () => {
      const src = read('components/InputBar.tsx');
      expect(src).toContain(
        'onClick={() => onReplyLengthChange(nextReplyLengthPreference(replyLength))}',
      );
    });

    it('writes the same storage key the settings sheet uses', () => {
      const store = stubStorage();
      // The component click path, replayed through the real helpers:
      // onClick → onReplyLengthChange(next) → App's handleReplyLengthChange
      // → writeReplyLengthPreference.
      const next = nextReplyLengthPreference(readReplyLengthPreference());
      writeReplyLengthPreference(next);
      expect(store.get(REPLY_LENGTH_STORAGE_KEY)).toBe('concise');
      expect(readReplyLengthPreference()).toBe('concise');

      const again = nextReplyLengthPreference(readReplyLengthPreference());
      writeReplyLengthPreference(again);
      expect(store.get(REPLY_LENGTH_STORAGE_KEY)).toBe('detailed');
    });

    it('App wires the toggle and the sheet to the same setter', () => {
      const app = read('App.tsx');
      // One setter, both consumers.
      const handler = app.match(
        /handleReplyLengthChange = useCallback\(\(next[^)]*\) => \{[\s\S]*?\}\)/,
      );
      expect(handler?.[0]).toContain('writeReplyLengthPreference(next)');
      expect(app).toContain('onReplyLengthChange={handleReplyLengthChange}');
      // ChatWindow forwards both props to the composer.
      const win = read('components/ChatWindow.tsx');
      expect(win).toContain('replyLength={replyLength}');
      expect(win).toContain('onReplyLengthChange={onReplyLengthChange}');
    });
  });

  describe('request body', () => {
    const fields = {
      sessionId: 's-1',
      message: '你好',
      profile: undefined,
      language: 'auto' as const,
    };

    it('默认 sends no hint — byte-identical to the pre-P196 body', () => {
      const body = buildChatRequestBody({
        ...fields,
        replyLength: replyLengthRequestField('default'),
      });
      expect(body).toBe('{"sessionId":"s-1","message":"你好","language":"auto"}');
      expect(JSON.parse(body)).not.toHaveProperty('replyLength');
    });

    it('精简 / 详细 inject the existing replyLength hint', () => {
      for (const pref of ['concise', 'detailed'] as const) {
        const body = buildChatRequestBody({
          ...fields,
          replyLength: replyLengthRequestField(pref),
        });
        expect(JSON.parse(body).replyLength).toBe(pref);
      }
    });
  });

  describe('P215 · narrow-width label keeps the unit word', () => {
    it('renders a narrow-only short prefix that names the unit', () => {
      const html = renderBar({ replyLength: 'default' });
      // Both prefixes render in markup; CSS picks which one is visible.
      expect(html).toContain('reply-length-prefix-narrow');
      const narrow = html.slice(
        html.indexOf('reply-length-prefix-narrow'),
        html.indexOf('input-hint'),
      );
      expect(narrow).toContain('长度·');
      expect(narrow).toContain('默认');
      // The long prefix is still present for ≥431 px.
      expect(html).toContain('回复长度·');
    });

    it('the narrow label changes with the tier', () => {
      for (const [pref, label] of [
        ['default', '默认'],
        ['concise', '精简'],
        ['detailed', '详细'],
      ] as const) {
        const html = renderBar({ replyLength: pref });
        const narrow = html.slice(
          html.indexOf('reply-length-prefix-narrow'),
          html.indexOf('input-hint'),
        );
        expect(narrow).toContain(`长度·`);
        expect(narrow).toContain(label);
      }
    });

    it('keeps the full aria-label at every width', () => {
      const html = renderBar({ replyLength: 'default' });
      expect(html).toContain('aria-label="回复长度：默认，点击切换为精简"');
      // The narrow span must not leak into the accessible name.
      const narrow = html.slice(
        html.indexOf('reply-length-prefix-narrow'),
        html.indexOf('input-hint'),
      );
      expect(narrow).toContain('aria-hidden="true"');
    });

    it('CSS shows the short prefix only at ≤430 px', () => {
      const css = read('components/InputBar.css');
      expect(css).toMatch(
        /\.reply-length-prefix-narrow\s*\{\s*display:\s*none/,
      );
      const media = css.match(
        /@media \(max-width: 430px\) \{[\s\S]*?\n\}/,
      )?.[0];
      expect(media).toBeTruthy();
      expect(media).toMatch(/\.reply-length-prefix\s*\{\s*display:\s*none/);
      expect(media).toMatch(
        /\.reply-length-prefix-narrow\s*\{\s*display:\s*inline/,
      );
    });

    it('默认 still sends no hint under the narrow label', () => {
      const body = buildChatRequestBody({
        sessionId: 's-1',
        message: '你好',
        profile: undefined,
        language: 'auto',
        replyLength: replyLengthRequestField('default'),
      });
      expect(JSON.parse(body)).not.toHaveProperty('replyLength');
    });
  });

  describe('single source of truth', () => {
    it('the settings sheet shows the 档位 the toggle last wrote', () => {
      stubStorage();
      writeReplyLengthPreference(
        nextReplyLengthPreference('default'),
      );
      const current = readReplyLengthPreference();
      const html = renderToStaticMarkup(
        createElement(SettingsSheet, {
          ...sheetProps,
          open: true,
          replyLength: current,
          onReplyLengthChange: noop,
        }),
      );
      // 精简 is the active segment; the other two stay unpressed.
      expect(html).toContain('aria-pressed="true" aria-label="精简"');
      expect(html).toContain('aria-pressed="false" aria-label="默认"');
      expect(html).toContain('aria-pressed="false" aria-label="详细"');
    });

    it('the toggle reflects a 档位 changed in the sheet', () => {
      // Sheet writes concise → App state updates → InputBar re-renders.
      const html = renderBar({ replyLength: 'concise' });
      expect(html).toContain('data-length="concise"');
      expect(html).toContain('aria-label="回复长度：精简，点击切换为详细"');
    });
  });
});
