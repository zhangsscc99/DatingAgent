/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { documentLangFor } from '../src/App';
import type { ReplyLanguage } from '../src/types';

/**
 * P128 — the <html lang> attribute follows the P09 reply-language setting so
 * screen readers / translation tooling get the right language. vitest runs in
 * node, so this exercises the exported pure mapping helper; the mount-side
 * effect is a one-line assignment in App.tsx.
 */
describe('P128 · documentLangFor', () => {
  it('maps en to en', () => {
    expect(documentLangFor('en')).toBe('en');
  });

  it('maps zh and auto to zh-CN (the shell stays Chinese)', () => {
    expect(documentLangFor('zh')).toBe('zh-CN');
    expect(documentLangFor('auto')).toBe('zh-CN');
  });

  it('falls back to zh-CN for unexpected values', () => {
    const bogus = 'fr' as unknown as ReplyLanguage;
    expect(documentLangFor(bogus)).toBe('zh-CN');
  });
});
