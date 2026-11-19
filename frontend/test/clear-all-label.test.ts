/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLEAR_ALL_LABEL } from '../src/lib/copy';

/**
 * P267 — one action carried three different labels: the sidebar said
 * 「清空全部」 with aria/title 「清空全部历史对话」, settings said
 * 「清空全部对话」, and the confirm title was 「清空全部历史对话」.
 * All entry points must now render the single shared constant.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P267 · one clear-all label everywhere', () => {
  it('CLEAR_ALL_LABEL is the settings wording', () => {
    expect(CLEAR_ALL_LABEL).toBe('清空全部对话');
  });

  it('Sidebar and SettingsSheet both render the shared constant, not literals', () => {
    for (const file of ['components/Sidebar.tsx', 'components/SettingsSheet.tsx']) {
      const src = read(file);
      expect(src).toContain("import { CLEAR_ALL_LABEL } from '../lib/copy'");
      // No hard-coded clear-all label strings left for that button.
      expect(src).not.toMatch(/aria-label="清空/);
      expect(src).not.toMatch(/title="清空/);
      expect(src).not.toMatch(/>\s*清空全部[^<]*</);
      expect(src).not.toContain('清空全部历史对话');
    }
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('aria-label={CLEAR_ALL_LABEL}');
    expect(sidebar).toContain('title={CLEAR_ALL_LABEL}');
    // P353: the sheet's zero-session hint is still built from the one
    // constant — a suffix on CLEAR_ALL_LABEL, not a second wording.
    const sheet = read('components/SettingsSheet.tsx');
    expect(sheet).toContain('aria-label={clearAllHint}');
    expect(sheet).toContain('title={clearAllHint}');
    expect(sheet).toContain('`${CLEAR_ALL_LABEL}（还没有对话可以清空）`');
  });

  it('App.tsx uses the constant for the clear-all confirm title', () => {
    const src = read('App.tsx');
    expect(src).toContain("import { CLEAR_ALL_LABEL } from './lib/copy'");
    expect(src).toContain(
      "confirmRequest.kind === 'clear-all' ? CLEAR_ALL_LABEL : '删除对话'",
    );
    expect(src).not.toContain('清空全部历史对话');
    // The confirm button label stays untouched.
    expect(src).toContain("confirmRequest.kind === 'clear-all' ? '清空全部' : '删除'");
  });
});
