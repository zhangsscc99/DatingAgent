import type { ChatMessage, ReplyVersionSnapshot } from '../types';

/**
 * P276 — 「换一个」 used to destroy the previous reply in place. The bubble
 * now parks one replaced version in `previousVersion`, and the 恢复上一版 /
 * 查看新版 toggle swaps the displayed text with the parked one. Exactly one
 * of the two slots is set at any time: `previousVersion` while the newest
 * reply shows, `newerVersion` while the parked older text is on screen.
 * Both slots are in-memory only — serializeMessages already whitelists the
 * fields it writes, so a refresh persists whichever version was displayed.
 */

/** Snapshot of the reply a bubble is currently showing. */
export function versionSnapshotOf(message: ChatMessage): ReplyVersionSnapshot {
  return {
    content: message.content,
    toolEvents: message.toolEvents,
    meta: message.meta,
    stopped: message.stopped,
    versionIndex: message.versionIndex,
  };
}

function applySnapshot(
  message: ChatMessage,
  snapshot: ReplyVersionSnapshot,
): ChatMessage {
  return {
    ...message,
    content: snapshot.content,
    toolEvents: snapshot.toolEvents,
    meta: snapshot.meta,
    stopped: snapshot.stopped,
    versionIndex: snapshot.versionIndex,
  };
}

/**
 * Swap the displayed reply with its parked version. The side the user was
 * looking at moves into the opposite slot, so the toggle works both ways.
 * Bubbles with nothing parked — or one mid-regeneration — pass through
 * untouched (and keep their array-slot identity for memo()).
 */
export function toggleReplyVersion(
  messages: ChatMessage[],
  messageId: string,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId || m.regenerating || m.streaming || m.error) return m;
    if (m.newerVersion) {
      return {
        ...applySnapshot(m, m.newerVersion),
        previousVersion: versionSnapshotOf(m),
        newerVersion: undefined,
      };
    }
    if (m.previousVersion) {
      return {
        ...applySnapshot(m, m.previousVersion),
        previousVersion: undefined,
        newerVersion: versionSnapshotOf(m),
      };
    }
    return m;
  });
}
