/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P148 — sidebar session deletion contract. Source-level guards (same approach
 * as a11y.test.ts / stop-generation.test.ts): they lock in the wiring between
 * the per-row delete button, the localStorage store, and the fire-and-forget
 * backend DELETE.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P148 · delete history session', () => {
  it('removes the session from the store and clears a dangling activeSessionId', () => {
    const storage = read('lib/chatStorage.ts');
    expect(storage).toContain('export function deleteChatSession(sessionId: string): void');
    const fn = storage.slice(storage.indexOf('export function deleteChatSession'));
    expect(fn).toContain('state.sessions.filter');
    expect(fn).toContain('state.activeSessionId === sessionId');
    expect(fn).toContain('state.activeSessionId = null');
  });

  it('renders a labelled, busy-disabled delete button as a sibling of the switch button', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('recent-chat-delete');
    expect(sidebar).toContain('删除对话：');
    expect(sidebar).toContain('onDeleteChat?.(s.id)');
    expect(sidebar).toContain('disabled={busy}');
    // Sibling, not nested: the delete button appears only after the switch
    // button's closing tag inside the same <li>.
    const switchClose = sidebar.indexOf('</button>', sidebar.indexOf('onSelectChat'));
    const deleteBtn = sidebar.indexOf('recent-chat-delete');
    expect(deleteBtn).toBeGreaterThan(switchClose);
  });

  it('confirms via the in-app dialog, then deletes locally, fires a best-effort backend DELETE, and resets an active chat', () => {
    const app = read('App.tsx');
    expect(app).toContain('onDeleteChat={handleDeleteChat}');
    expect(app).not.toContain('window.confirm');
    // P228: the row button only opens the ConfirmDialog with the session title.
    const request = app.slice(
      app.indexOf('const handleDeleteChat'),
      app.indexOf('const performDeleteChat'),
    );
    expect(request).toContain('setConfirmRequest');
    expect(request).not.toContain('deleteChatSession(id)');
    // The confirmed path keeps the exact P148 behaviour.
    const handler = app.slice(app.indexOf('const performDeleteChat'));
    expect(handler).toContain('deleteChatSession(id)');
    expect(handler).toContain('encodeURIComponent(id)');
    expect(handler).toContain("method: 'DELETE'");
    expect(handler).toContain('.catch(() => {})');
    expect(handler).toContain('id === sessionId');
    expect(handler).toContain('setMessages([])');
    expect(handler).toContain('setSessionId(null)');
  });
});
