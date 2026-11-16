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
  /** Document title; blank or absent keeps the generic export heading. */
  title?: string;
  /** Timestamp used for the "exported at" line; defaults to now. */
  exportedAt?: number;
}

const CONTROL_CHAR_RUN = /[\u0000-\u001f\u007f-\u009f]+/g;
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;
const EDGE_DOTS_AND_SPACES_START = /^[.\s]+/;
const EDGE_DOTS_AND_SPACES_END = /[.\s]+$/;
const FILENAME_TITLE_MAX = 40;

/** P179 — heading for a supplied session title. Titles come from the user's
 * own first message or a rename, so control characters are flattened to
 * single spaces and HTML-significant chars escaped like message content.
 * Blank titles keep the generic heading byte-identical to before. */
function exportHeading(rawTitle: string | undefined): string {
  const title = (rawTitle ?? '').replace(CONTROL_CHAR_RUN, ' ').trim();
  return escapeHtml(title || 'DatingAgent 对话记录');
}

/** P179 — make a session title usable as a filename component: characters
 * illegal on common filesystems (`\ / : * ? " < > |`) and control characters
 * are removed, edge dots/spaces trimmed (a trailing dot is unwritable on
 * Windows), CJK kept as-is, capped at 40 characters. Returns "" when nothing
 * usable remains — callers then keep the plain timestamped name. */
export function sanitizeFilenamePart(raw: string): string {
  const cleaned = raw
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(EDGE_DOTS_AND_SPACES_START, '')
    .replace(EDGE_DOTS_AND_SPACES_END, '');
  return Array.from(cleaned)
    .slice(0, FILENAME_TITLE_MAX)
    .join('')
    .replace(EDGE_DOTS_AND_SPACES_END, '');
}

/** Messages worth exporting: every finished bubble. In-flight streams are
 * never exported and empty user bubbles carry nothing, but a failed or
 * empty assistant reply still earns a placeholder row (P180) so the saved
 * transcript matches what stayed on screen. */
export function exportableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => !m.streaming && (m.role !== 'user' || m.content.trim().length > 0),
  );
}

/** P180 — the body line for one exported bubble. A non-streaming assistant
 * bubble with nothing usable (error flag, or empty/whitespace content)
 * becomes a single blockquote placeholder instead of being dropped; every
 * other bubble renders exactly as before. */
function exportBodyLine(message: ChatMessage): string {
  const unusable =
    message.role === 'assistant' &&
    (message.error || message.content.trim().length === 0);
  if (!unusable) {
    return escapeHtml(message.content.trimEnd());
  }
  const detail =
    (message.errorDetail ?? '').trim() ||
    (message.error ? message.content.trim() : '');
  return detail
    ? `> （此条回复生成失败或已停止：${escapeHtml(detail)}）`
    : '> （此条回复生成失败或已停止）';
}

export function buildConversationMarkdown(
  messages: ChatMessage[],
  options: ExportOptions = {},
): string {
  const { exportedAt = Date.now() } = options;
  const rows = exportableMessages(messages);

  const lines: string[] = [`# ${exportHeading(options.title)}`, ''];
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

    lines.push(exportBodyLine(message), '');
    if (index < rows.length - 1) lines.push('---', '');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

/** `datingagent-chat-20261114-1305.md`, or
 * `datingagent-chat-<title>-20261114-1305.md` when a usable title is given. */
export function conversationFilename(now: number = Date.now(), title?: string): string {
  const d = new Date(now);
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const part = title ? sanitizeFilenamePart(title) : '';
  return part
    ? `datingagent-chat-${part}-${stamp}.md`
    : `datingagent-chat-${stamp}.md`;
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
