/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isImeComposing,
  shouldHandleEscape,
  shouldSubmitOnEnter,
} from '../src/lib/ime';

/**
 * P167 — IME composition guard contract. The pure-function block exercises
 * the three event shapes the helpers must accept (React synthetic event
 * with `nativeEvent`, DOM KeyboardEvent with `isComposing`, and the legacy
 * `keyCode === 229` marker); the source-guard block locks in that the
 * composer and both sidebar inputs route Enter/Escape through them.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P167 · IME composition guards', () => {
  describe('isImeComposing', () => {
    it('flags a React synthetic event mid-composition', () => {
      expect(
        isImeComposing({ key: 'Enter', nativeEvent: { isComposing: true } }),
      ).toBe(true);
    });

    it('flags a DOM event carrying isComposing directly', () => {
      expect(isImeComposing({ key: 'Enter', isComposing: true })).toBe(true);
    });

    it('flags the legacy keyCode 229 process marker', () => {
      expect(isImeComposing({ key: 'Enter', keyCode: 229 })).toBe(true);
    });

    it('is false for finished compositions and ordinary keys', () => {
      expect(
        isImeComposing({ key: 'Enter', isComposing: false, keyCode: 13 }),
      ).toBe(false);
      expect(isImeComposing({ key: 'a' })).toBe(false);
      expect(isImeComposing({})).toBe(false);
    });
  });

  describe('shouldSubmitOnEnter', () => {
    it('sends on a plain Enter', () => {
      expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false })).toBe(true);
      expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: false })).toBe(true);
    });

    it('does not send while composing', () => {
      expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true })).toBe(false);
      expect(
        shouldSubmitOnEnter({ key: 'Enter', nativeEvent: { isComposing: true } }),
      ).toBe(false);
      expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
    });

    it('keeps Shift+Enter as a newline, never a send', () => {
      expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true })).toBe(false);
    });

    it('still sends on Ctrl/Cmd+Enter', () => {
      expect(shouldSubmitOnEnter({ key: 'Enter', ctrlKey: true })).toBe(true);
      expect(shouldSubmitOnEnter({ key: 'Enter', metaKey: true })).toBe(true);
    });

    it('ignores non-Enter keys', () => {
      expect(shouldSubmitOnEnter({ key: 'a' })).toBe(false);
      expect(shouldSubmitOnEnter({ key: 'Escape' })).toBe(false);
      expect(shouldSubmitOnEnter({ key: 'ArrowUp' })).toBe(false);
    });
  });

  describe('shouldHandleEscape', () => {
    it('acts on a plain Escape', () => {
      expect(shouldHandleEscape({ key: 'Escape' })).toBe(true);
      expect(shouldHandleEscape({ key: 'Escape', isComposing: false })).toBe(true);
    });

    it('leaves a composing Escape to the IME', () => {
      expect(shouldHandleEscape({ key: 'Escape', isComposing: true })).toBe(false);
      expect(
        shouldHandleEscape({ key: 'Escape', nativeEvent: { isComposing: true } }),
      ).toBe(false);
      expect(shouldHandleEscape({ key: 'Escape', keyCode: 229 })).toBe(false);
    });

    it('ignores non-Escape keys', () => {
      expect(shouldHandleEscape({ key: 'Enter' })).toBe(false);
      expect(shouldHandleEscape({ key: 'a' })).toBe(false);
    });
  });

  describe('source guards', () => {
    it('InputBar imports the helper and gates Enter through it', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain("from '../lib/ime'");
      expect(bar).toContain('shouldSubmitOnEnter(e)');
      // The guard returns before preventDefault/submit, so a composing
      // Enter reaches neither — the IME keeps the key.
      const submitIdx = bar.indexOf('submit();');
      const guardIdx = bar.indexOf('if (!shouldSubmitOnEnter(e)) return;');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(submitIdx);
    });

    it('Sidebar imports the helpers and guards rename + filter keys', () => {
      const sidebar = read('components/Sidebar.tsx');
      expect(sidebar).toContain("from '../lib/ime'");
      // Rename input: Enter commits, Escape cancels — both guarded.
      expect(sidebar).toContain('if (shouldSubmitOnEnter(e)) commitRename();');
      expect(sidebar).toContain('if (shouldHandleEscape(e)) setEditingId(null);');
      // Filter input Escape is guarded too (two uses total in the file).
      const filterInput = sidebar.slice(
        sidebar.indexOf('recent-chat-filter'),
        sidebar.indexOf('className="recent-chat-list"'),
      );
      expect(filterInput).toContain('shouldHandleEscape(e)');
      expect(
        sidebar.match(/shouldHandleEscape\(e\)/g)?.length,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});
