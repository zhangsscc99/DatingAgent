/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClearAllUndo } from '../src/lib/clearAllUndo';
import {
  loadTrash,
  removeTrashEntries,
  restoreTrash,
  saveTrash,
  type TrashEntry,
} from '../src/lib/chatTrash';
import {
  clearAllChatSessions,
  deleteChatSession,
  loadChatState,
  restoreChatSession,
  restoreChatState,
  saveChatSession,
} from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P273 — 清空全部 → 撤销 used to leave the just-cleared sessions in the
 * recycle bin: the confirm pushed them into `datingAgent.trash` while the
 * undo only wrote the chatHistory snapshot back. Opening the bin and
 * pressing 恢复 then appended a second, identically-titled row for the
 * same sessionId. The undo now retracts exactly its own clear's trash
 * entries through an optional `removeTrash` op, and the restore path is
 * idempotent — a same-id live session is overwritten by the trash copy,
 * never duplicated. Behavioural blocks drive the pure core and the
 * storage wiring against a stubbed localStorage; a source guard locks
 * the App wiring.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const user = (content: string, createdAt = 1_000): ChatMessage => ({
  id: `u-${createdAt}`,
  role: 'user',
  content,
  createdAt,
});

const entry = (
  sessionId: string,
  messages: ChatMessage[],
  deletedAt = Date.now(),
): TrashEntry => ({
  sessionId,
  title: `标题 ${sessionId}`,
  messages,
  deletedAt,
  messageCount: messages.length,
});

/** The App.tsx wiring, verbatim: helper + saveTrash. */
const removeTrash = (ids: string[]) =>
  saveTrash(removeTrashEntries(loadTrash(), ids));

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
}

describe('P273 · clear-all undo retracts its own trash entries', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({} as Response)));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('清空全部 → 撤销 leaves none of the cleared ids in the trash', () => {
    saveChatSession('s1', [user('第一条')]);
    saveChatSession('s2', [user('第二条'), user('第二条续')]);
    // An unrelated entry from an earlier delete must survive the undo.
    saveChatSession('old', [user('更早删掉的')]);
    deleteChatSession('old');
    expect(loadTrash().map((e) => e.sessionId)).toEqual(['old']);

    const ctl = createClearAllUndo(() => {});
    ctl.confirm({
      takeSnapshot: loadChatState,
      wipe: clearAllChatSessions,
      restore: restoreChatState,
      removeTrash,
    });
    // The clear pushed s1+s2 into the bin next to the older entry.
    expect(new Set(loadTrash().map((e) => e.sessionId))).toEqual(
      new Set(['old', 's1', 's2']),
    );

    ctl.undo();

    expect(
      loadChatState()
        .sessions.map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2']);
    expect(loadTrash().map((e) => e.sessionId)).toEqual(['old']);
    ctl.destroy();
  });

  it('restoring a sessionId that is already live keeps sessions.length unchanged', () => {
    saveChatSession('s1', [user('live copy')]);
    saveTrash([entry('s1', [user('trash copy'), user('trash tail')])]);
    const before = loadChatState().sessions.length;

    const restored = restoreChatSession('s1');

    expect(restored).not.toBeNull();
    expect(restored!.id).toBe('s1');
    const state = loadChatState();
    expect(state.sessions).toHaveLength(before);
    // The trash copy won: messages came from the bin, entry dropped.
    expect(state.sessions[0].messages.map((m) => m.content)).toEqual([
      'trash copy',
      'trash tail',
    ]);
    expect(loadTrash()).toHaveLength(0);
  });

  it('a normal delete → restore still adds exactly one session', () => {
    saveChatSession('s1', [user('误删')]);
    saveChatSession('s2', [user('留下的')]);
    deleteChatSession('s1');
    expect(loadChatState().sessions.map((s) => s.id)).toEqual(['s2']);

    const restored = restoreChatSession('s1');

    expect(restored).not.toBeNull();
    const state = loadChatState();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0].id).toBe('s1');
    expect(loadTrash()).toHaveLength(0);
  });

  it('without removeTrash, undo behaves exactly as before', () => {
    saveChatSession('s1', [user('hi')]);
    const restore = vi.fn(restoreChatState);
    const ctl = createClearAllUndo(() => {});
    ctl.confirm({
      takeSnapshot: loadChatState,
      wipe: clearAllChatSessions,
      restore,
    });

    expect(() => ctl.undo()).not.toThrow();

    // Snapshot written back — and the trash still holds the cleared
    // entry, matching the pre-P273 contract for uninjected callers.
    expect(restore).toHaveBeenCalledTimes(1);
    expect(loadChatState().sessions.map((s) => s.id)).toEqual(['s1']);
    expect(loadTrash().map((e) => e.sessionId)).toEqual(['s1']);
    ctl.destroy();
  });

  it('removeTrashEntries is pure — new array out, input untouched', () => {
    const entries = [
      entry('a', [user('1')]),
      entry('b', [user('2')]),
      entry('c', [user('3')]),
    ];
    const next = removeTrashEntries(entries, ['a', 'c']);
    expect(next.map((e) => e.sessionId)).toEqual(['b']);
    expect(next).not.toBe(entries);
    expect(entries.map((e) => e.sessionId)).toEqual(['a', 'b', 'c']);
    // Nothing to remove → every entry kept, still a fresh array.
    const same = removeTrashEntries(entries, []);
    expect(same).toHaveLength(3);
    expect(same).not.toBe(entries);
  });

  it('restoreTrash itself overwrites a same-id live session in place', () => {
    const live = {
      activeSessionId: null,
      sessions: [
        { id: 's1', title: '新', updatedAt: 9, messages: [user('live')] },
      ],
    };
    saveTrash([entry('s1', [user('bin')], 9_000)]);
    const result = restoreTrash(live, 's1', 10_000);
    expect(result!.state.sessions).toHaveLength(1);
    expect(result!.state.sessions[0].updatedAt).toBe(10_000);
    expect(result!.state.sessions[0].messages[0].content).toBe('bin');
  });

  it('App wires removeTrash (helper + saveTrash) into the clear-all confirm', () => {
    const app = read('App.tsx');
    expect(app).toContain('removeTrashEntries');
    const handler = app.slice(app.indexOf('const handleClearAllChats'));
    expect(handler).toContain('removeTrash: (ids) => {');
    expect(handler).toContain('saveTrash(removeTrashEntries(loadTrash(), ids))');
    expect(handler).toContain('setTrashEntries(loadTrash())');
  });
});
