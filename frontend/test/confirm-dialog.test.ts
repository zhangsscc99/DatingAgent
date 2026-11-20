/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';

/**
 * P228 — the two most destructive actions in the app (清空全部 and per-row
 * 删除对话) used to fall back to the browser's native confirm, the only
 * overlay that was not the app's own styled layer. Both now open the shared
 * ConfirmDialog ([role="alertdialog"], panel-focused, Escape/overlay cancel,
 * focus returns to the trigger) and window.confirm is never called.
 *
 * Vitest runs in node, so App mounts against the same minimal fake DOM as
 * send-while-streaming.test.ts. react-dom is imported lazily inside the test
 * — its canUseDOM flag is captured at module evaluation time, so it must load
 * only after installFakeDom() has populated window/document.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P228 · in-app confirm dialog', () => {
  let dom: FakeDom;
  let deleteCalls: string[];

  const qs = (sel: string) => dom.document.querySelector(sel);
  const alertDialog = () => qs('[role="alertdialog"]');
  const cancelButton = () =>
    dom.document
      .querySelectorAll('.confirm-btn')
      .find((b) => !(b as FakeElement).classList.contains('danger'));
  const dangerButton = () => qs('.confirm-btn.danger');

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const keydown = async (key: string, props: Record<string, unknown> = {}) => {
    await act(async () => {
      dom.document.dispatchEvent(
        new FakeEvent('keydown', {
          bubbles: true,
          cancelable: true,
          props: { key, ...props },
        }),
      );
    });
  };

  beforeAll(() => {
    dom = installFakeDom();
    deleteCalls = [];
    const fetchMock = vi.fn(
      async (input: unknown, init?: { method?: string }) => {
        const url =
          typeof input === 'string'
            ? input
            : String((input as { url?: string })?.url);
        if (init?.method === 'DELETE') {
          deleteCalls.push(url);
          return jsonResponse({ deleted: true });
        }
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({
            status: 'ok',
            llmConfigured: true,
            llmModel: 'qwen3.8-flash',
          });
        }
        if (url === '/api/version') {
          return jsonResponse({ version: 'test', gitSha: 'abc' });
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    // Skip the onboarding modal: the composer must be the first surface.
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it(
    'confirms delete and clear-all through the app dialog, never window.confirm',
    async () => {
    const { saveChatSession, setActiveSessionId, loadChatState } =
      await import('../src/lib/chatStorage');
    saveChatSession('s1', [{ id: 'u1', role: 'user', content: '周末安排' }]);
    saveChatSession('s2', [{ id: 'u2', role: 'user', content: '晚安问候' }]);
    setActiveSessionId(null);

    const confirmSpy = vi.spyOn(dom.window, 'confirm');
    // Bare globalThis.confirm() would bypass the window property — guard it too.
    (globalThis as { confirm?: unknown }).confirm = confirmSpy;

    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
    await flush();

    // --- single-session delete ---------------------------------------
    const deleteBtn = qs('[aria-label="删除对话：周末安排"]') as FakeElement;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.focus();
    await click(deleteBtn);

    let dialog = alertDialog();
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.getAttribute('aria-labelledby')).toBe('confirm-dialog-title');
    expect(dialog!.getAttribute('aria-describedby')).toBe('confirm-dialog-desc');
    // P266: the description now names the count and the 回收站 recovery.
    expect(dialog!.textContent).toContain(
      '将把「周末安排」的 1 条消息移到回收站，7 天内可以恢复。',
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    // P401: mount focus lands on the panel, never on a button.
    expect(dom.document.activeElement).toBe(qs('.confirm-panel'));

    // 取消 closes without touching the store, and focus returns to the row.
    await click(cancelButton());
    expect(alertDialog()).toBeNull();
    expect(loadChatState().sessions).toHaveLength(2);
    expect(dom.document.activeElement).toBe(deleteBtn);

    // The danger button is the only path that deletes.
    await click(deleteBtn);
    expect(alertDialog()!.textContent).toContain(
      '将把「周末安排」的 1 条消息移到回收站，7 天内可以恢复。',
    );
    await click(dangerButton());
    expect(alertDialog()).toBeNull();
    expect(loadChatState().sessions.map((s) => s.id)).toEqual(['s2']);
    expect(deleteCalls).toEqual(['/api/session/s1']);

    // --- 清空全部: Escape cancels and focus returns to the trigger ----
    const clearBtn = qs('.recent-chat-clear-all') as FakeElement;
    expect(clearBtn).not.toBeNull();
    clearBtn.focus();
    await click(clearBtn);

    dialog = alertDialog();
    expect(dialog).not.toBeNull();
    // P266: one session with one message remains after the s1 delete.
    // P357: the body now uses the same 「移到回收站」 wording as a delete.
    expect(dialog!.textContent).toContain(
      '将把 1 段对话（共 1 条消息）移到回收站，7 天内可以恢复。',
    );
    expect(dom.document.activeElement).toBe(qs('.confirm-panel'));
    expect(confirmSpy).not.toHaveBeenCalled();

    await keydown('Escape');
    expect(alertDialog()).toBeNull();
    expect(loadChatState().sessions).toHaveLength(1);
    expect(dom.document.activeElement).toBe(clearBtn);

    // Clicking the dimmed overlay (not the panel) cancels too.
    await click(clearBtn);
    const overlay = qs('.confirm-overlay') as FakeElement;
    expect(overlay).not.toBeNull();
    await click(overlay);
    expect(alertDialog()).toBeNull();
    expect(loadChatState().sessions).toHaveLength(1);

    // Tab wraps inside the dialog: from the danger button back to 取消.
    await click(clearBtn);
    (dangerButton() as FakeElement).focus();
    await keydown('Tab');
    expect(dom.document.activeElement).toBe(cancelButton());
    await keydown('Tab', { shiftKey: true });
    expect(dom.document.activeElement).toBe(dangerButton());

    // Confirmed clear empties the store through the same handleClearAllChats.
    await click(dangerButton());
    expect(alertDialog()).toBeNull();
    expect(loadChatState().sessions).toEqual([]);

    expect(confirmSpy).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    },
  );

  describe('source guards', () => {
    it('window.confirm is gone from every file under frontend/src', () => {
      const entries = readdirSync(SRC, { recursive: true }) as string[];
      const sources = entries.filter((f) => /\.(ts|tsx|css)$/.test(f));
      expect(sources.length).toBeGreaterThan(0);
      for (const file of sources) {
        if (read(file).includes('window.confirm')) {
          throw new Error(`window.confirm still present in src/${file}`);
        }
      }
    });

    it('the dialog copy comes from the shared confirmDialogCopy builder', () => {
      const app = read('App.tsx');
      expect(app).toContain('confirmDialogCopy(confirmRequest)');
      expect(app).not.toContain('确定清空全部历史对话？');
      const copy = read('lib/confirmCopy.ts');
      expect(copy).toContain('confirmDialogCopy');
      expect(copy).toContain('移到回收站，7 天内可以恢复。');
    });

    it('ConfirmDialog is a labelled alertdialog with a danger primary and panel mount focus', () => {
      const src = read('components/ConfirmDialog.tsx');
      expect(src).toContain('role="alertdialog"');
      expect(src).toContain('aria-modal="true"');
      expect(src).toContain('aria-labelledby="confirm-dialog-title"');
      expect(src).toContain('aria-describedby="confirm-dialog-desc"');
      expect(src).toContain('confirm-btn danger');
      expect(src).toContain('取消');
      expect(src).toContain('panelRef.current?.focus()');
      expect(src).toContain("e.key === 'Escape'");
    });
  });
});
