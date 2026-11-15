/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadInputHistory, pushInputHistory } from '../src/lib/inputHistory';

/**
 * P06 — input-history recall contract. Behavioural tests exercise
 * loadInputHistory/pushInputHistory against a stubbed localStorage (node
 * env, same approach as rename-session.test.ts); source-level guards lock
 * in the composer wiring for ArrowUp/ArrowDown recall and the send-path
 * recording in App.tsx.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const STORAGE_KEY = 'datingagent.input-history.v1';

describe('P06 · input history recall', () => {
  describe('source guards', () => {
    it('stores history under the versioned key, newest last', () => {
      const lib = read('lib/inputHistory.ts');
      expect(lib).toContain(`'${STORAGE_KEY}'`);
      expect(lib).toContain('export function loadInputHistory(): string[]');
      expect(lib).toContain('export function pushInputHistory(text: string): string[]');
    });

    it('wires ArrowUp/ArrowDown recall guarded by caret position', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain('loadInputHistory');
      expect(bar).toContain("e.key === 'ArrowUp'");
      expect(bar).toContain("e.key === 'ArrowDown'");
      expect(bar).toContain('selectionStart === 0');
      expect(bar).toContain('stepBackHistory');
      expect(bar).toContain('stepForwardHistory');
    });

    it('restores the pre-browse draft on Escape / past-newest and keeps blur otherwise', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain("e.key === 'Escape'");
      expect(bar).toContain('browseDraftRef');
      expect(bar).toContain('setText(browseDraftRef.current)');
      // The original F10 behaviour is still there for the non-browsing case.
      expect(bar).toContain('textareaRef.current?.blur()');
    });

    it('announces recall through the visually-hidden aria-live pattern', () => {
      const bar = read('components/InputBar.tsx');
      expect(bar).toContain('已恢复历史消息');
      const live = bar.slice(bar.indexOf('historyAnnouncement') - 300);
      expect(live).toContain('sr-only');
      expect(live).toContain('aria-live="polite"');
    });

    it('records each sent message on the existing App.tsx send path', () => {
      const app = read('App.tsx');
      expect(app).toContain("import { pushInputHistory } from './lib/inputHistory'");
      const send = app.slice(app.indexOf('const sendMessage'));
      expect(send).toContain('pushInputHistory(prompt)');
    });
  });

  describe('inputHistory behaviour', () => {
    let store: Map<string, string>;

    beforeEach(() => {
      store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('returns [] on empty and on corrupt stored JSON', () => {
      expect(loadInputHistory()).toEqual([]);
      store.set(STORAGE_KEY, '{not json');
      expect(loadInputHistory()).toEqual([]);
      store.set(STORAGE_KEY, '{"a":1}');
      expect(loadInputHistory()).toEqual([]);
      store.set(STORAGE_KEY, '[1,2,3]');
      expect(loadInputHistory()).toEqual([]);
    });

    it('trims outer whitespace and ignores empty input', () => {
      expect(pushInputHistory('  你好  ')).toEqual(['你好']);
      pushInputHistory('   ');
      pushInputHistory('');
      expect(loadInputHistory()).toEqual(['你好']);
    });

    it('drops a new entry equal to the most recent one only', () => {
      pushInputHistory('a');
      pushInputHistory('a');
      pushInputHistory('b');
      expect(loadInputHistory()).toEqual(['a', 'b']);
      // Non-consecutive repeats are real entries.
      pushInputHistory('a');
      expect(loadInputHistory()).toEqual(['a', 'b', 'a']);
    });

    it('keeps at most 5 entries, newest last', () => {
      for (const m of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) pushInputHistory(m);
      expect(loadInputHistory()).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
    });

    it('drops oldest entries to stay under the ~10 KB serialized cap', () => {
      const big = 'x'.repeat(3900);
      for (let i = 0; i < 5; i++) pushInputHistory(`${big}${i}`);
      const history = loadInputHistory();
      expect(history.length).toBeLessThan(5);
      expect(history.length).toBeGreaterThan(0);
      expect(JSON.stringify(history).length).toBeLessThanOrEqual(10 * 1024);
      // The newest entry is always the last to be dropped.
      expect(history[history.length - 1]).toBe(`${big}4`);
    });

    it('does not throw when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
        clear: () => {},
      });
      expect(() => pushInputHistory('hi')).not.toThrow();
      expect(() => loadInputHistory()).not.toThrow();
      // The in-memory fallback keeps the just-pushed entry recallable.
      const loaded = loadInputHistory();
      expect(loaded[loaded.length - 1]).toBe('hi');
    });
  });
});
