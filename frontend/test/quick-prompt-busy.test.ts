/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canRunQuickPrompt } from '../src/lib/quickPromptGate';

/**
 * P172 — a quick-prompt tap during reply generation was silently dropped:
 * `sendMessage` early-returns while `loading`, but the click handler still
 * ran `closeSidebar()`, so on mobile the drawer closed, nothing was sent
 * and the user got no feedback. The gate now blocks the handler while busy
 * and the buttons are disabled in the DOM.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P172 · quick prompt busy gate', () => {
  describe('canRunQuickPrompt', () => {
    it('allows a quick prompt while idle', () => {
      expect(canRunQuickPrompt(false)).toBe(true);
    });

    it('blocks a quick prompt while a reply is in flight', () => {
      expect(canRunQuickPrompt(true)).toBe(false);
    });
  });

  describe('source guards', () => {
    it('Sidebar.tsx disables quick-btn buttons while busy', () => {
      const sidebar = read('components/Sidebar.tsx');
      const quickBtn = sidebar.slice(sidebar.indexOf('className="quick-btn"'));
      const buttonBlock = quickBtn.slice(0, quickBtn.indexOf('</button>'));
      expect(buttonBlock).toContain('disabled={busy}');
      expect(buttonBlock).toContain('aria-disabled={busy || undefined}');
      expect(buttonBlock).toContain('回复生成中，请稍候');
    });

    it('Sidebar.tsx keeps new-chat-btn enabled while busy', () => {
      const sidebar = read('components/Sidebar.tsx');
      const newChat = sidebar.slice(sidebar.indexOf('className="new-chat-btn"'));
      const buttonBlock = newChat.slice(0, newChat.indexOf('</button>'));
      expect(buttonBlock).not.toContain('disabled={busy}');
    });

    it('App.tsx gates the quick-prompt handler before closeSidebar', () => {
      const app = read('App.tsx');
      expect(app).toContain("from './lib/quickPromptGate'");
      const handler = app.slice(app.indexOf('onQuickPrompt={(prompt)'));
      const handlerBlock = handler.slice(0, handler.indexOf('}}'));
      // The busy gate must early-return before handleQuickPrompt/closeSidebar.
      expect(handlerBlock.indexOf('canRunQuickPrompt(loading')).toBeGreaterThanOrEqual(0);
      expect(handlerBlock.indexOf('canRunQuickPrompt(loading)')).toBeLessThan(
        handlerBlock.indexOf('closeSidebar()'),
      );
      // closeSidebar is not called unconditionally on the quick-prompt path.
      expect(handlerBlock).not.toMatch(/onQuickPrompt=\{\(prompt\) => \{\s*handleQuickPrompt/);
    });
  });
});
