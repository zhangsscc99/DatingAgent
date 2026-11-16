/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../src/components/Sidebar';
import SettingsSheet from '../src/components/SettingsSheet';
import { startDialogDismiss } from '../src/lib/dialogDismiss';
import { buildChatRequestBody } from '../src/lib/chatRequest';
import {
  readReplyLengthPreference,
  replyLengthRequestField,
  writeReplyLengthPreference,
} from '../src/lib/replyLength';

/**
 * P196 — settings entry point + sheet contract. Vitest runs in node: the
 * markup assertions go through renderToStaticMarkup (no effects run, so the
 * version fetch never fires), the Escape/focus contract is exercised through
 * the same fake EventTarget document as modal-escape.test.ts, and storage
 * uses an in-memory localStorage stub. Source guards pin the wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const noop = () => {};

const sheetProps = {
  onClose: noop,
  replyLength: 'default' as const,
  onReplyLengthChange: noop,
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

function renderSheet(open: boolean, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(SettingsSheet, { ...sheetProps, open, ...extra }),
  );
}

interface FakeEl {
  focus: ReturnType<typeof vi.fn>;
  hasAttribute(name: string): boolean;
}

const fakeEl = (): FakeEl => ({ focus: vi.fn(), hasAttribute: () => false });

type FakeDoc = EventTarget & {
  activeElement: unknown;
  body: unknown;
  contains(el: unknown): boolean;
};

/** Document stand-in: `mounted` is the set of elements still attached. */
function makeDoc() {
  const doc = new EventTarget() as FakeDoc;
  const mounted = new Set<unknown>();
  const body = fakeEl();
  doc.body = body;
  doc.activeElement = body;
  doc.contains = (el: unknown) => el === body || mounted.has(el);
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  return { doc, body, mounted };
}

const keydown = (key: string, shiftKey = false) =>
  Object.assign(new Event('keydown'), { key, shiftKey });

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P196 · settings sheet', () => {
  describe('trigger', () => {
    it('renders a gear button in the sidebar footer with accessible name 设置', () => {
      const html = renderToStaticMarkup(
        createElement(Sidebar, { tools: [], onQuickPrompt: noop, onNewChat: noop }),
      );
      expect(html).toContain('settings-open-btn');
      expect(html).toContain('aria-label="设置"');
      expect(html).toContain('title="设置"');
      // The trigger lives in the sidebar footer — after the 快捷入口 section.
      expect(html.indexOf('settings-open-btn')).toBeGreaterThan(html.indexOf('快捷入口'));
    });

    it('is wired to the sheet in App.tsx', () => {
      const app = read('App.tsx');
      expect(app).toContain('onOpenSettings={() => setSettingsOpen(true)}');
      expect(app).toContain('<SettingsSheet');
      expect(app).toContain('onClose={() => setSettingsOpen(false)}');
    });
  });

  describe('sections', () => {
    it('renders the five sections when open', () => {
      const html = renderSheet(true);
      for (const heading of ['回复长度偏好', '语言', '主题', '数据', '关于']) {
        expect(html).toContain(`<h3>${heading}</h3>`);
      }
      // Segmented reply-length control: 默认 / 精简 / 详细.
      for (const label of ['默认', '精简', '详细']) {
        expect(html).toContain(label);
      }
      // Data actions + about placeholder (version fetch is an effect — never
      // fires under SSR, so the loading copy is what markup shows).
      expect(html).toContain('导出 Markdown');
      expect(html).toContain('导出 JSON');
      expect(html).toContain('清空全部对话');
      expect(html).toContain('版本');
    });

    it('renders nothing when closed', () => {
      expect(renderSheet(false)).toBe('');
    });

    it('renders the model line only when llmModel is supplied', () => {
      expect(renderSheet(true)).not.toContain('模型 ');
      expect(renderSheet(true, { llmModel: 'qwen3.8-flash' })).toContain('模型 qwen3.8-flash');
    });

    it('is a labelled modal dialog', () => {
      const html = renderSheet(true);
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('id="settings-title"');
    });
  });

  describe('Escape + focus contract', () => {
    it('wires Escape/Tab/focus-restore through startDialogDismiss', () => {
      const sheet = read('components/SettingsSheet.tsx');
      expect(sheet).toContain('startDialogDismiss({');
      expect(sheet).toContain('onClose,');
      expect(sheet).toContain('opener: openerRef.current');
      // The trigger is captured before the open commit lands.
      expect(sheet).toContain('openerRef.current = open ? document.activeElement : null');
    });

    it('Escape invokes onClose and stop() returns focus to the trigger', () => {
      const { doc, mounted } = makeDoc();
      const onClose = vi.fn();
      const opener = fakeEl();
      const panel = { querySelectorAll: () => [] };
      mounted.add(panel);
      mounted.add(opener);

      const handle = startDialogDismiss({
        onClose,
        getPanel: () => panel as unknown as Element,
        opener: opener as unknown as Element,
      });
      doc.dispatchEvent(keydown('Escape'));
      expect(onClose).toHaveBeenCalledTimes(1);

      // Sheet closes → panel unmounts → focus returns to the gear button.
      mounted.delete(panel);
      handle.stop();
      expect(opener.focus).toHaveBeenCalledTimes(1);
    });

    it('keeps the mobile drawer Escape from racing the sheet', () => {
      const app = read('App.tsx');
      expect(app).toContain("e.key === 'Escape' && !settingsOpen");
    });
  });

  describe('reply-length preference', () => {
    it('persists across a simulated reload', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
      writeReplyLengthPreference('detailed');
      // A fresh read stands in for a reload: module state is never consulted.
      expect(readReplyLengthPreference()).toBe('detailed');
      expect(store.get('datingagent.replyLength')).toBe('detailed');
    });

    it('falls back to 默认 on missing or corrupt storage', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
      expect(readReplyLengthPreference()).toBe('default');
      store.set('datingagent.replyLength', 'bogus');
      expect(readReplyLengthPreference()).toBe('default');
    });
  });

  describe('request builder', () => {
    const fields = {
      sessionId: 's-1',
      message: '你好',
      profile: undefined,
      language: 'auto' as const,
    };

    it('默认 sends no replyLength field — byte-identical to the pre-P196 body', () => {
      const body = buildChatRequestBody({
        ...fields,
        replyLength: replyLengthRequestField('default'),
      });
      expect(body).toBe('{"sessionId":"s-1","message":"你好","language":"auto"}');
      expect(JSON.parse(body)).not.toHaveProperty('replyLength');
      expect(replyLengthRequestField('default')).toBeUndefined();
    });

    it('non-default preferences map to the request hint values', () => {
      expect(replyLengthRequestField('detailed')).toBe('detailed');
      expect(replyLengthRequestField('concise')).toBe('concise');
      const body = buildChatRequestBody({
        ...fields,
        replyLength: replyLengthRequestField('detailed'),
      });
      expect(JSON.parse(body).replyLength).toBe('detailed');
      expect(body).toBe(
        '{"sessionId":"s-1","message":"你好","language":"auto","replyLength":"detailed"}',
      );
    });

    it('keeps the profile key out of a default body when absent', () => {
      const body = JSON.parse(
        buildChatRequestBody({ sessionId: null, message: 'hi', language: 'zh' }),
      );
      expect(body).toEqual({ sessionId: null, message: 'hi', language: 'zh' });
    });
  });
});
