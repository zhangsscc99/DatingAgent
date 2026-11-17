/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  clearAllConfirmRequest,
  deleteConfirmRequest,
  describeConfirm,
} from '../src/lib/confirmCopy';
import type { ChatStorageState } from '../src/lib/chatStorage';
import type { ChatMessage } from '../src/types';

/**
 * P266 — the destructive confirm dialogs used to ask one bare question
 * (「删除对话「…」？」 / 「确定清空全部历史对话？」) that hid the blast
 * radius and the recovery path. The description now states the counts and
 * the way back: single delete → the 7-day 回收站, 清空全部 → the same
 * 7-day 回收站 (P269 — a 6 s undo toast exists but is unreachable in
 * practice, so the copy leads with the durable path). Counts are frozen into
 * the request when the dialog opens, so the copy cannot drift. These tests
 * pin the sentences at the pure-function level plus a source guard that
 * App really routes both actions through describeConfirm.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const msg = (id: string): ChatMessage => ({ id, role: 'user', content: id });

const stateWith = (
  sessions: Array<{ id: string; title: string; messages: ChatMessage[] }>,
): ChatStorageState => ({
  activeSessionId: null,
  sessions: sessions.map((s) => ({ ...s, updatedAt: 1 })),
});

describe('P266 · confirm dialog states counts and recovery', () => {
  it('single delete names the real message count, the 回收站 and the 7 天 window', () => {
    const state = stateWith([
      { id: 's1', title: '周末安排', messages: [msg('a'), msg('b'), msg('c')] },
    ]);
    const request = deleteConfirmRequest(state, 's1', '周末安排');
    const copy = describeConfirm(request);
    expect(copy).toContain('周末安排');
    expect(copy).toContain('3 条消息');
    expect(copy).toContain('回收站');
    expect(copy).toContain('7 天');
    expect(copy).toBe('将把「周末安排」的 3 条消息移到回收站，7 天内可以恢复。');
  });

  it('clear-all names the session count, the summed message count and the 7 天 回收站', () => {
    const state = stateWith([
      { id: 's1', title: '甲', messages: [msg('a'), msg('b'), msg('c')] },
      { id: 's2', title: '乙', messages: [msg('d'), msg('e')] },
    ]);
    const request = clearAllConfirmRequest(state);
    const copy = describeConfirm(request);
    expect(copy).toContain('2 段对话');
    expect(copy).toContain('5 条消息');
    expect(copy).toContain('回收站');
    expect(copy).toContain('7 天');
    expect(copy).not.toContain('6 秒');
    expect(copy).not.toContain('撤销');
    expect(copy).toBe('将清空 2 段对话，共 5 条消息；清空后可在回收站保留 7 天，之后自动清除。');
  });

  it('single delete still promises 「7 天内可以恢复」 unchanged', () => {
    const state = stateWith([
      { id: 's1', title: '甲', messages: [msg('a')] },
    ]);
    const copy = describeConfirm(deleteConfirmRequest(state, 's1', '甲'));
    expect(copy).toContain('7 天内可以恢复');
  });

  it('neither description is the old bare 「确定清空全部历史对话？」', () => {
    const state = stateWith([
      { id: 's1', title: '周末安排', messages: [msg('a')] },
    ]);
    expect(describeConfirm(clearAllConfirmRequest(state))).not.toBe(
      '确定清空全部历史对话？',
    );
    expect(describeConfirm(deleteConfirmRequest(state, 's1', '周末安排'))).not.toBe(
      '确定清空全部历史对话？',
    );
  });

  it('a zero-message session falls back to a count-free sentence — never 「0 条消息」', () => {
    const state = stateWith([{ id: 's1', title: '空会话', messages: [] }]);
    const copy = describeConfirm(deleteConfirmRequest(state, 's1', '空会话'));
    expect(copy).toBe('将把这个对话移到回收站，7 天内可以恢复。');
    expect(copy).not.toContain('0 条消息');
    expect(copy).not.toContain('空会话');
  });

  it('empty or missing state degrades to zero counts without throwing', () => {
    const empty = clearAllConfirmRequest({
      activeSessionId: null,
      sessions: [],
    });
    expect(empty).toEqual({
      kind: 'clear-all',
      sessionCount: 0,
      messageCount: 0,
    });
    expect(() =>
      clearAllConfirmRequest(undefined as unknown as ChatStorageState),
    ).not.toThrow();
    const missing = deleteConfirmRequest(
      { activeSessionId: null, sessions: [] },
      'gone',
      'gone',
    );
    expect(missing.messageCount).toBe(0);
  });

  it('counts are frozen at request time, not re-read by describeConfirm', () => {
    const request = {
      kind: 'delete' as const,
      sessionId: 's1',
      title: '旧快照',
      messageCount: 7,
    };
    // No state argument at all — the number travels inside the request.
    expect(describeConfirm(request)).toContain('7 条消息');
  });

  it('App captures counts via the shared builders and renders describeConfirm', () => {
    const app = read('App.tsx');
    expect(app).toContain('deleteConfirmRequest(loadChatState(), id, title)');
    expect(app).toContain('clearAllConfirmRequest(loadChatState())');
    expect(app).toContain('describeConfirm(confirmRequest)');
    // Both 清空全部 entry points still share the one request path.
    expect(app).toContain('onClearAllChats={requestClearAllChats}');
    expect(app).toContain('onClearAll={requestClearAllChats}');
    // The old bare copy is gone from the dialog wiring.
    expect(app).not.toContain('确定清空全部历史对话？');
  });
});
