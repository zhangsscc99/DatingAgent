/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissReceiptItem,
  dismissedReceiptItems,
  restoreReceiptItem,
} from '../src/lib/memoryReceiptDismissals';
import { memoryReceiptItems } from '../src/lib/memoryReceipt';
import type { ChatMessage } from '../src/types';

/**
 * P330 — deleting a fact from the memory capsule used to be irreversible:
 * the × button wrote straight into `datingagent.memoryDismissals` with no
 * undo. `restoreReceiptItem` removes the entry again so a dismissed fact
 * can re-enter the receipt derivation. Same localStorage stub pattern as
 * memory-receipt.test.ts — the module only ever touches `localStorage`.
 */

const STORAGE_KEY = 'datingagent.memoryDismissals';

let store: Map<string, string>;

function stubStorage() {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(stubStorage);
afterEach(() => vi.unstubAllGlobals());

/** The same derivation the capsule runs over. */
const factTurns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '我昨晚没睡好，一直在想怎么回她' },
  { id: 'a1', role: 'assistant', content: '先接住自己，再来想措辞。' },
  { id: 'u2', role: 'user', content: '周末本来想约她去看展' },
  { id: 'a2', role: 'assistant', content: '这个安排很轻，适合开口。' },
];

const receiptItems = () =>
  memoryReceiptItems(null, 'default', factTurns).filter(
    (item) => !dismissedReceiptItems().includes(item),
  );

describe('P330 · restoreReceiptItem', () => {
  it('removes the item and returns the new persisted list', () => {
    dismissReceiptItem('看展');
    dismissReceiptItem('没睡好');
    const next = restoreReceiptItem('看展');
    expect(next).toEqual(['没睡好']);
    expect(dismissedReceiptItems()).toEqual(['没睡好']);
    expect(store.get(STORAGE_KEY)).toBe('["没睡好"]');
  });

  it('is idempotent: restoring a non-dismissed item changes nothing', () => {
    dismissReceiptItem('看展');
    dismissReceiptItem('没睡好');
    const next = restoreReceiptItem('加班');
    expect(next).toEqual(['看展', '没睡好']);
    expect(dismissedReceiptItems()).toEqual(['看展', '没睡好']);
    // Restoring twice keeps the single removal — no duplicate, no reorder.
    restoreReceiptItem('看展');
    expect(restoreReceiptItem('看展')).toEqual(['没睡好']);
    expect(dismissedReceiptItems()).toEqual(['没睡好']);
  });

  it('returns the current list untouched for blank input', () => {
    dismissReceiptItem('看展');
    expect(restoreReceiptItem('')).toEqual(['看展']);
    expect(restoreReceiptItem('   ')).toEqual(['看展']);
    expect(dismissedReceiptItems()).toEqual(['看展']);
  });

  it('trims the input before matching', () => {
    dismissReceiptItem('看展');
    restoreReceiptItem('  看展  ');
    expect(dismissedReceiptItems()).toEqual([]);
  });

  it('a dismissed-then-restored fact is no longer filtered out of the receipt', () => {
    expect(receiptItems()).toContain('看展');
    dismissReceiptItem('看展');
    expect(receiptItems()).not.toContain('看展');
    restoreReceiptItem('看展');
    expect(receiptItems()).toContain('看展');
    expect(receiptItems()).toContain('没睡好');
  });

  it('keeps at most 100 dismissals and evicts the OLDEST on overflow', () => {
    for (let i = 0; i < 105; i += 1) dismissReceiptItem(`fact-${i}`);
    const list = dismissedReceiptItems();
    expect(list).toHaveLength(100);
    // The five oldest entries are gone; the newest 100 survive in order.
    expect(list[0]).toBe('fact-5');
    expect(list[99]).toBe('fact-104');
    expect(list).not.toContain('fact-0');
    // An evicted entry can no longer be restored — the undo is a no-op.
    expect(restoreReceiptItem('fact-0')).toHaveLength(100);
    // …while restoring a live entry still works after the overflow.
    expect(restoreReceiptItem('fact-104')).toHaveLength(99);
    expect(dismissedReceiptItems()).not.toContain('fact-104');
  });
});
