import type { ChatMessage } from '../types';

/**
 * Conversation export (F07): render the on-screen conversation as Markdown and
 * hand it to the browser as a `.md` download.
 *
 * Message creation times are not part of the SSE payload, so each entry uses
 * `createdAt` (set when the bubble is created) and falls back to the
 * epoch-millis embedded in the message id (`u-1750000000000`). Older persisted
 * sessions only carry ids, so the fallback keeps their timestamps meaningful.
 */

const ID_TIMESTAMP = /^[ua]-(\d{12,})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD HH:MM` in local time. */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function messageTime(message: ChatMessage): number | null {
  if (typeof message.createdAt === 'number' && Number.isFinite(message.createdAt)) {
    return message.createdAt;
  }
  const match = ID_TIMESTAMP.exec(message.id);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Escape HTML-significant characters in untrusted message text (P110).
 * `&` must be replaced first so existing entities aren't double-escaped.
 * Only applied to user/LLM content — the Markdown scaffold we generate stays raw.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function roleHeading(message: ChatMessage): string {
  return message.role === 'user' ? '你' : 'DatingAgent';
}

export interface ExportOptions {
  /** Document title; defaults to a generic export heading. */
  title?: string;
  /** Timestamp used for the "exported at" line; defaults to now. */
  exportedAt?: number;
}

/** Messages worth exporting: finished bubbles with actual text. */
export function exportableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.streaming && !m.error && m.content.trim().length > 0);
}

export function buildConversationMarkdown(
  messages: ChatMessage[],
  options: ExportOptions = {},
): string {
  const { title = 'DatingAgent 对话记录', exportedAt = Date.now() } = options;
  const rows = exportableMessages(messages);

  const lines: string[] = [`# ${title}`, ''];
  lines.push(`- 导出时间：${formatTimestamp(exportedAt)}`);
  lines.push(`- 消息数：${rows.length}`);
  lines.push('');

  rows.forEach((message, index) => {
    const time = messageTime(message);
    const heading = time === null
      ? `## ${roleHeading(message)}`
      : `## ${roleHeading(message)} · ${formatTimestamp(time)}`;
    lines.push(heading, '');

    if (message.toolEvents && message.toolEvents.length > 0) {
      const labels = message.toolEvents.map((t) => t.label || t.name).join('、');
      lines.push(`> 工具：${labels}`, '');
    }

    lines.push(escapeHtml(message.content.trimEnd()), '');
    if (index < rows.length - 1) lines.push('---', '');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

/** `datingagent-chat-20261114-1305.md` */
export function conversationFilename(now: number = Date.now()): string {
  const d = new Date(now);
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `datingagent-chat-${stamp}.md`;
}

/** Trigger a client-side download. Returns false if the Blob/anchor path fails. */
export function downloadMarkdown(markdown: string, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;

  let url: string | null = null;
  try {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } catch {
    return false;
  } finally {
    if (url) {
      // Give the browser a tick to start the download before releasing the blob.
      const blobUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
  }
}
