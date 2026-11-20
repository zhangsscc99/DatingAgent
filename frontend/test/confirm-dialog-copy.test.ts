/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { confirmDialogCopy, describeConfirm } from '../src/lib/confirmCopy';
import { CLEAR_ALL_LABEL } from '../src/lib/copy';

/**
 * P357 — the clear-all confirm used to speak three ways at once (title
 * 「清空全部对话」, body 「将清空 1 段对话…」, button 「清空全部」) and the
 * brand-outlined 取消 visually outweighed the pale-red danger button.
 * confirmDialogCopy is now the single source for all three strings, and
 * the CSS gives the destructive action a solid bold --danger fill next
 * to a quiet neutral 取消. These tests pin the copy at the pure-function
 * level plus source guards on the stylesheet and the App wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

/** Extract the declarations of one rule block, e.g. `.confirm-btn.danger {…}`. */
const block = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
};

describe('P357 · one copy source for the confirm dialog', () => {
  it('clear-all: the title states the body count, the button the action', () => {
    const copy = confirmDialogCopy({
      kind: 'clear-all',
      sessionCount: 1,
      messageCount: 6,
    });
    // P401: 「清空 1 段对话」, not 「清空全部对话」 — title and body agree.
    expect(copy.title).toBe('清空 1 段对话');
    expect(copy.confirmLabel).toBe(CLEAR_ALL_LABEL);
    expect(copy.description).toContain('1 段对话');
    expect(copy.description).toContain('6 条消息');
    expect(copy.description).toContain('回收站');
    expect(copy.description).not.toContain('将清空');
  });

  it('the session count scales the title — 清空全部 N 段对话 beyond one', () => {
    const copy = confirmDialogCopy({
      kind: 'clear-all',
      sessionCount: 3,
      messageCount: 9,
    });
    expect(copy.description).toContain('3 段对话');
    expect(copy.title).toBe('清空全部 3 段对话');
    expect(copy.confirmLabel).toBe(CLEAR_ALL_LABEL);
  });

  it('delete keeps the session name, its message count and the 回收站 window', () => {
    const copy = confirmDialogCopy({
      kind: 'delete',
      sessionId: 's1',
      title: '周末安排',
      messageCount: 4,
    });
    expect(copy.title).toBe('删除这段对话');
    expect(copy.confirmLabel).toBe('删除');
    expect(copy.description).toBe(
      '将把「周末安排」的 4 条消息移到回收站，7 天内可以恢复。',
    );
  });

  it('a zero-message delete falls back to the count-free sentence', () => {
    const copy = confirmDialogCopy({
      kind: 'delete',
      sessionId: 's1',
      title: '空会话',
      messageCount: 0,
    });
    expect(copy.description).toBe('将把这个对话移到回收站，7 天内可以恢复。');
    expect(copy.description).not.toContain('0 条消息');
  });

  it('describeConfirm delegates to the same builder — no second wording', () => {
    const request = {
      kind: 'clear-all' as const,
      sessionCount: 2,
      messageCount: 5,
    };
    expect(describeConfirm(request)).toBe(
      confirmDialogCopy(request).description,
    );
  });

  it('the danger button is a solid --danger fill; 取消 is a neutral outline', () => {
    const css = read('components/ConfirmDialog.css');
    const danger = block(css, '.confirm-btn.danger');
    expect(danger).toContain('background: var(--danger)');
    expect(danger).toContain('color: #fff');
    expect(danger).toContain('font-weight: 700');
    // --danger-soft is no longer the danger button's background.
    expect(danger).not.toContain('--danger-soft');
    const base = block(css, '.confirm-btn');
    expect(base).toContain('var(--border)');
    expect(base).toContain('color: var(--text-secondary)');
    expect(block(css, '.confirm-actions')).toContain('gap: 12px');
  });

  it('App takes all three strings from confirmDialogCopy — no per-kind fork', () => {
    const app = read('App.tsx');
    expect(app).toContain('confirmDialogCopy(confirmRequest)');
    expect(app).not.toContain('confirmLabel={confirmRequest.kind ===');
    expect(app).not.toContain("? '清空全部' : '删除'");
  });
});
