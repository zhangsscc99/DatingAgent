/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/types';
import {
  CHAT_STORAGE_SCHEMA_VERSION,
  clearLastMigration,
  getLastMigration,
  loadChatState,
  saveChatSession,
} from '../src/lib/chatStorage';

/**
 * P314 — the chat-history payload used to carry no schema marker, so a
 * rebuild that changed the store shape could only drop what it did not
 * understand. The payload is now stamped with an explicit schema version;
 * a load that sees a missing/older stamp migrates in place (normalise +
 * rewrite + stamp + console.info record) instead of discarding sessions,
 * and a newer/unknown stamp is loaded as-is — never wiped.
 */

const STORAGE_KEY = 'datingAgent.chatHistory';
const VERSION_KEY = 'datingAgent.schemaVersion';

const msg = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 1_000,
});

const storedSession = (id: string, content: string) => ({
  id,
  title: content,
  updatedAt: 1,
  messages: [{ id: `u-${id}`, role: 'user', content }],
});

const legacyPayload = (ids: string[]) =>
  JSON.stringify({
    activeSessionId: ids[0] ?? null,
    sessions: ids.map((id) => storedSession(id, `对话 ${id}`)),
  });

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
  return store;
}

describe('P314 · chat-history schema version + in-place migration', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = stubStorage();
    clearLastMigration();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('a legacy payload (no version stamp) migrates in place — sessions preserved, log emitted', () => {
    store.set(STORAGE_KEY, legacyPayload(['s1', 's2', 's3']));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const state = loadChatState();
    expect(state.sessions).toHaveLength(3);
    expect(state.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(state.activeSessionId).toBe('s1');

    const migration = getLastMigration();
    expect(migration).not.toBeNull();
    expect(migration?.fromVersion).toBe(1);
    expect(migration?.toVersion).toBe(CHAT_STORAGE_SCHEMA_VERSION);
    expect(migration?.sessionCount).toBe(3);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('migrated schema'));

    // In place: the stored payload keeps every session (the read path stays
    // read-only — the version stamp is the migration) and the version is
    // stamped.
    const stored = JSON.parse(store.get(STORAGE_KEY)!) as {
      sessions: { id: string }[];
    };
    expect(stored.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(store.get(VERSION_KEY)).toBe(String(CHAT_STORAGE_SCHEMA_VERSION));

    // The migration runs once — later loads see the stamp and stay quiet.
    info.mockClear();
    loadChatState();
    expect(info).not.toHaveBeenCalled();
  });

  it('a legacy payload stamped with an old version number also migrates', () => {
    store.set(STORAGE_KEY, legacyPayload(['s1', 's2']));
    store.set(VERSION_KEY, '1');

    const state = loadChatState();
    expect(state.sessions).toHaveLength(2);
    expect(getLastMigration()?.fromVersion).toBe(1);
    expect(store.get(VERSION_KEY)).toBe(String(CHAT_STORAGE_SCHEMA_VERSION));
  });

  it('a current-version payload loads untouched — no rewrite, no migration', () => {
    const payload = legacyPayload(['s1', 's2']);
    store.set(STORAGE_KEY, payload);
    store.set(VERSION_KEY, String(CHAT_STORAGE_SCHEMA_VERSION));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const state = loadChatState();
    expect(state.sessions).toHaveLength(2);
    expect(store.get(STORAGE_KEY)).toBe(payload);
    expect(getLastMigration()).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('a newer version stamp (downgrade) is left alone — sessions load, nothing is wiped', () => {
    const payload = legacyPayload(['s1', 's2']);
    store.set(STORAGE_KEY, payload);
    store.set(VERSION_KEY, '99');

    const state = loadChatState();
    expect(state.sessions).toHaveLength(2);
    expect(store.get(STORAGE_KEY)).toBe(payload);
    expect(store.get(VERSION_KEY)).toBe('99');
    expect(getLastMigration()).toBeNull();
  });

  it('a non-numeric version stamp is treated as legacy — migrate, keep sessions', () => {
    store.set(STORAGE_KEY, legacyPayload(['s1', 's2']));
    store.set(VERSION_KEY, 'not-a-version');

    const state = loadChatState();
    expect(state.sessions).toHaveLength(2);
    expect(getLastMigration()?.fromVersion).toBe(1);
    expect(store.get(VERSION_KEY)).toBe(String(CHAT_STORAGE_SCHEMA_VERSION));
  });

  it('every persistState write stamps the current schema version', () => {
    saveChatSession('s1', [msg('u1', '她今天回得很快')]);
    expect(store.get(VERSION_KEY)).toBe(String(CHAT_STORAGE_SCHEMA_VERSION));
  });

  it('save → module re-init → load keeps every session (the rebuild round trip)', async () => {
    saveChatSession('s1', [msg('u1', '第一条')]);
    saveChatSession('s2', [msg('u2', '第二条')]);
    const before = loadChatState().sessions.length;
    expect(before).toBe(2);

    // The rebuild window: fresh module state, same localStorage.
    vi.resetModules();
    const fresh = await import('../src/lib/chatStorage');
    const state = fresh.loadChatState();
    expect(state.sessions).toHaveLength(before);
    expect(state.sessions.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(fresh.getLastMigration()).toBeNull();
  });

  it('a legacy payload across a module re-init migrates, not discards', async () => {
    store.set(STORAGE_KEY, legacyPayload(['s1', 's2', 's3']));

    vi.resetModules();
    const fresh = await import('../src/lib/chatStorage');
    const state = fresh.loadChatState();
    expect(state.sessions).toHaveLength(3);
    expect(fresh.getLastMigration()?.fromVersion).toBe(1);
    expect(fresh.getLastMigration()?.sessionCount).toBe(3);
    expect(store.get(VERSION_KEY)).toBe(
      String(fresh.CHAT_STORAGE_SCHEMA_VERSION),
    );
  });
});
