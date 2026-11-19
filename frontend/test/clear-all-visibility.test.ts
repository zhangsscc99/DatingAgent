/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldShowClearAll } from '../src/lib/sidebarListState';

/**
 * P270 — with 0 stored sessions the sidebar still rendered
 * 「清空全部对话」; clicking it opened a confirm for 「将清空 0 段对话，
 * 共 0 条消息」, a destructive no-op. The sidebar control now renders
 * only when a session exists, via the shared helper. P353 changed the
 * settings-sheet surface: hiding the entry there left a phone with no
 * reachable data-management entry at all, so the sheet keeps it mounted
 * but inert (disabled + hint, no click handler) — the no-op confirm
 * still cannot open. No DOM harness — pure assertions plus source-level
 * guards on both surfaces.
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

  it('SettingsSheet keeps the entry visible but inert at zero sessions (P353)', () => {
    const src = read('components/SettingsSheet.tsx');
    expect(src).toMatch(/className="settings-data-btn danger"/);
    // Rendered unconditionally — the viewport/session gate is gone.
    expect(src).not.toMatch(/shouldShowClearAll\(hasSessions\)\s*&&/);
    // …but inert at zero sessions: disabled, no click handler wired, and
    // a hint explains why instead of a hidden capability.
    expect(src).toContain('disabled={busy || !hasSessions}');
    expect(src).toContain('aria-disabled');
    expect(src).toContain('onClick={hasSessions ? onClearAll : undefined}');
    expect(src).toContain('还没有对话可以清空');
    expect(src).toContain('CLEAR_ALL_LABEL');
  });
});
