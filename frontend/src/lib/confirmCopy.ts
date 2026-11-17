import type { ChatStorageState } from './chatStorage';

/**
 * P266 — the destructive-action confirm dialog used to ask one bare
 * question (「删除对话「…」？」 / 「确定清空全部历史对话？」) that said
 * nothing about blast radius or the way back. The description now states
 * how many messages the action touches and what recovery looks like: a
 * single delete moves the session into the 7-day 回收站; 清空全部 moves
 * the sessions into the same 7-day 回收站 (a 6 s undo toast also exists
 * via clearAllUndo.ts, but the copy leads with the durable recovery
 * path). Counts are captured when the dialog
 * is requested so the sentence cannot drift while it is open, and both
 * 清空全部 entry points share the one request builder. Pure copy + count
 * plumbing — no React, no localStorage.
 */

/** A pending destructive action awaiting the in-app confirm dialog. */
export type ConfirmRequest =
  | { kind: 'clear-all'; sessionCount: number; messageCount: number }
  | { kind: 'delete'; sessionId: string; title: string; messageCount: number };

function messageCountOf(session: { messages?: unknown } | undefined): number {
  return session && Array.isArray(session.messages)
    ? session.messages.length
    : 0;
}

/**
 * Build the clear-all request from the stored state at request time. An
 * empty or unreadable state degrades to zero counts — never throws.
 */
export function clearAllConfirmRequest(
  state: ChatStorageState,
): ConfirmRequest {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const messageCount = sessions.reduce((n, s) => n + messageCountOf(s), 0);
  return { kind: 'clear-all', sessionCount: sessions.length, messageCount };
}

/**
 * Build the single-delete request from the same stored state. A session
 * missing from the store (or carrying a non-array messages field) reports
 * 0 messages — never throws.
 */
export function deleteConfirmRequest(
  state: ChatStorageState,
  sessionId: string,
  title: string,
): ConfirmRequest {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const messageCount = messageCountOf(
    sessions.find((s) => s?.id === sessionId),
  );
  return { kind: 'delete', sessionId, title, messageCount };
}

/**
 * The dialog description for a pending request. A session with no
 * messages falls back to a count-free sentence rather than 「0 条消息」;
 * 清空全部 always has ≥1 session so it keeps the counts.
 */
export function describeConfirm(request: ConfirmRequest): string {
  if (request.kind === 'clear-all') {
    return `将清空 ${request.sessionCount} 段对话，共 ${request.messageCount} 条消息；清空后可在回收站保留 7 天，之后自动清除。`;
  }
  if (request.messageCount > 0) {
    return `将把「${request.title}」的 ${request.messageCount} 条消息移到回收站，7 天内可以恢复。`;
  }
  return '将把这个对话移到回收站，7 天内可以恢复。';
}
