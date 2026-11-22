/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, type FakeDom } from './helpers/fakeDom';
import { retireQueue } from '../src/lib/sendQueue';
import { draftStorageKey, readDraft, saveDraft } from '../src/lib/chatDrafts';

/**
 * P429 — retiring the send queue used to overwrite the target session's
 * whole draft key with just the queued prompts: saveDraft writes the key
 * wholesale and never reads it, so 「第三条」 typed after 「第二条」 was
 * queued vanished the moment the user switched conversations. retireQueue
 * now takes an optional `read` and merges queued prompts ahead of the
 * draft already in that session's box — the same order restoreQueuedDraft
 * uses for 「取消排队」 — and App passes readDraft so the live app merges.
 * Without `read` the legacy overwrite is pinned unchanged.
 *
 * Same fake-DOM localStorage stub as queue-session-switch.test.ts
 * (vitest runs in node — no real Storage).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P429 · retiring the queue merges with the session draft', () => {
  let dom: FakeDom;

  beforeAll(() => {
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dom.localStorage.clear();
  });

  const draftOf = (sid: string) => dom.localStorage.getItem(draftStorageKey(sid));

  describe('merge behaviour', () => {
    it('queued text rejoins ahead of the existing draft — nothing is lost', () => {
      saveDraft('sess-a', '第三条');
      const remainder = retireQueue(
        [{ sessionId: 'sess-a', prompt: '第二条' }],
        saveDraft,
        readDraft,
      );
      expect(remainder).toEqual([]);
      expect(draftOf('sess-a')).toBe('第二条\n第三条');
    });

    it('an empty existing draft yields the same bytes as the legacy write', () => {
      const remainder = retireQueue(
        [{ sessionId: 'sess-b', prompt: '第二条' }],
        saveDraft,
        readDraft,
      );
      expect(remainder).toEqual([]);
      expect(draftOf('sess-b')).toBe('第二条');
    });

    it('joins a same-session queue FIFO ahead of the existing draft', () => {
      saveDraft('sess-c', '已有');
      const remainder = retireQueue(
        [
          { sessionId: 'sess-c', prompt: 'q1' },
          { sessionId: 'sess-c', prompt: 'q2' },
          { sessionId: 'sess-c', prompt: 'q3' },
        ],
        saveDraft,
        readDraft,
      );
      expect(remainder).toEqual([]);
      expect(draftOf('sess-c')).toBe('q1\nq2\nq3\n已有');
    });

    it('the merged text is still capped at 4096 chars and never throws', () => {
      saveDraft('sess-d', 'x'.repeat(4090));
      expect(() =>
        retireQueue(
          [{ sessionId: 'sess-d', prompt: 'y'.repeat(100) }],
          saveDraft,
          readDraft,
        ),
      ).not.toThrow();
      const merged = draftOf('sess-d') ?? '';
      expect(merged).toHaveLength(4096);
      // Queued text leads — all of it survives; the existing draft is clipped.
      expect(merged.startsWith('y'.repeat(100))).toBe(true);
    });

    it('a throwing read still writes the queued text', () => {
      saveDraft('sess-e', '旧草稿');
      const remainder = retireQueue(
        [{ sessionId: 'sess-e', prompt: '第二条' }],
        saveDraft,
        () => {
          throw new Error('denied');
        },
      );
      expect(remainder).toEqual([]);
      expect(draftOf('sess-e')).toBe('第二条');
    });
  });

  describe('legacy behaviour without read', () => {
    it('still overwrites the existing draft wholesale', () => {
      saveDraft('sess-f', '旧草稿');
      const remainder = retireQueue(
        [{ sessionId: 'sess-f', prompt: '第二条' }],
        saveDraft,
      );
      expect(remainder).toEqual([]);
      expect(draftOf('sess-f')).toBe('第二条');
    });
  });

  describe('readDraft', () => {
    it("returns '' when the key is absent", () => {
      expect(readDraft('nothing-here')).toBe('');
      saveDraft('sess-g', 'hi');
      expect(readDraft('sess-g')).toBe('hi');
    });

    it("returns '' instead of throwing when storage throws", () => {
      const denied = () => {
        throw new Error('denied');
      };
      vi.stubGlobal('localStorage', {
        getItem: denied,
        setItem: denied,
        removeItem: denied,
        clear: denied,
      });
      expect(readDraft('sess-a')).toBe('');
    });
  });

  describe('source guards', () => {
    it('App retires the queue through saveDraft + readDraft', () => {
      const app = read('App.tsx');
      expect(app).toContain(
        'retireQueue(pendingQueueRef.current, saveDraft, readDraft)',
      );
    });
  });
});
