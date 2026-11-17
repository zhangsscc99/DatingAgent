/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowClearAll } from '../src/lib/sidebarListState';

/**
 * P270 — with 0 stored sessions the sidebar still rendered
 * 「清空全部对话」; clicking it opened a confirm for 「将清空 0 段对话，
 * 共 0 条消息」, a destructive no-op. The control now renders only when a
 * session exists, in both the sidebar and the settings sheet, via one
 * shared helper so the two surfaces cannot drift. No DOM harness — pure
 * assertions plus a source-level guard that both components consult the
 * helper.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const fakeSession = (id: string) => ({
  id,
  title: '对话',
  messages: [],
  updatedAt: 1,
  createdAt: 1,
});

describe('P270 · clear-all control hidden at zero sessions', () => {
  it('returns false for an empty list, true with sessions', () => {
    expect(shouldShowClearAll([])).toBe(false);
    expect(shouldShowClearAll(0)).toBe(false);
    expect(shouldShowClearAll(false)).toBe(false);
    expect(shouldShowClearAll([fakeSession('s1')])).toBe(true);
    expect(shouldShowClearAll(1)).toBe(true);
    expect(shouldShowClearAll(true)).toBe(true);
  });

  it('after clearing all sessions the control disappears again', () => {
    const sessions = [fakeSession('a'), fakeSession('b')];
    expect(shouldShowClearAll(sessions)).toBe(true);
    sessions.length = 0;
    expect(shouldShowClearAll(sessions)).toBe(false);
    // And it comes back when a session exists again (restore / new / undo).
    expect(shouldShowClearAll([fakeSession('restored')])).toBe(true);
  });

  it('Sidebar gates the clear-all button on the shared helper', () => {
    const src = read('components/Sidebar.tsx');
    expect(src).toContain('shouldShowClearAll');
    expect(src).toMatch(/shouldShowClearAll\(recentSessions\)\s*&&/);
    expect(src).toMatch(/className="recent-chat-clear-all"/);
  });

  it('SettingsSheet gates its clear-all button on the same helper', () => {
    const src = read('components/SettingsSheet.tsx');
    expect(src).toContain(
      "import { shouldShowClearAll } from '../lib/sidebarListState'",
    );
    expect(src).toMatch(/shouldShowClearAll\(hasSessions\)\s*&&/);
    expect(src).toMatch(/className="settings-data-btn danger"/);
  });
});
