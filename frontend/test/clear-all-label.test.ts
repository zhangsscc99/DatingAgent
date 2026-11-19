/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLEAR_ALL_LABEL, CLEAR_ALL_TRASH_TITLE } from '../src/lib/copy';

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
      // P378: Sidebar also imports the derived tooltip constant — both
      // names still come from the one copy module.
      expect(src).toMatch(/import \{[^}]*CLEAR_ALL_LABEL[^}]*\} from '\.\.\/lib\/copy'/);
      // No hard-coded clear-all label strings left for that button.
      expect(src).not.toMatch(/aria-label="清空/);
      expect(src).not.toMatch(/title="清空/);
      expect(src).not.toMatch(/>\s*清空全部[^<]*</);
      expect(src).not.toContain('清空全部历史对话');
    }
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('aria-label={CLEAR_ALL_LABEL}');
    // P378: the tooltip names the 回收站 destination, derived from the same
    // constant — still no second hard-coded wording for the action itself.
    expect(sidebar).toContain('title={CLEAR_ALL_TRASH_TITLE}');
    expect(CLEAR_ALL_TRASH_TITLE).toBe(`${CLEAR_ALL_LABEL}（移到回收站）`);
    // P353: the sheet's zero-session hint is still built from the one
    // constant — a suffix on CLEAR_ALL_LABEL, not a second wording.
    const sheet = read('components/SettingsSheet.tsx');
    expect(sheet).toContain('aria-label={clearAllHint}');
    expect(sheet).toContain('title={clearAllHint}');
    expect(sheet).toContain('`${CLEAR_ALL_LABEL}（还没有对话可以清空）`');
  });

  it('the clear-all confirm copy comes from the constant via confirmDialogCopy', () => {
    // P357: App no longer forks title/label per kind — confirmDialogCopy
    // is the one source, and it renders CLEAR_ALL_LABEL for both.
    const app = read('App.tsx');
    expect(app).toContain('confirmDialogCopy(confirmRequest)');
    expect(app).not.toContain("confirmRequest.kind === 'clear-all' ?");
    expect(app).not.toContain('清空全部历史对话');
    const lib = read('lib/confirmCopy.ts');
    expect(lib).toContain("import { CLEAR_ALL_LABEL } from './copy'");
    expect(lib).toContain('title: CLEAR_ALL_LABEL');
    expect(lib).toContain('confirmLabel: CLEAR_ALL_LABEL');
  });
});
