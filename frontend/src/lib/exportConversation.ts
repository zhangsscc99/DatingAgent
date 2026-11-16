import type { ChatMessage, ToolEvent } from '../types';

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

/** `UTC+08:00` / `UTC+00:00` / `UTC-05:00` — the Date's real local offset,
 * so an exported timestamp stays unambiguous on another device (P182). */
export function formatUtcOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `YYYY-MM-DD HH:MM (UTC±HH:MM)` in local time. */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())} (${formatUtcOffset(d)})`
  );
}

/** `2026-11-16T08:58:00+08:00` — ISO-8601 local time with the UTC offset
 * attached, so a JSON export stays unambiguous across devices (P181). */
export function formatIsoOffset(ms: number): string {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
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

/** Plain-text normalised title shared by the Markdown heading and the
 * JSON `title` field (P181): control characters flattened, trimmed,
 * falling back to the generic name. */
function exportTitleText(rawTitle: string | undefined): string {
  const title = (rawTitle ?? '').replace(CONTROL_CHAR_RUN, ' ').trim();
  return title || 'DatingAgent 对话记录';
}

/** P179 — heading for a supplied session title. Titles come from the user's
 * own first message or a rename, so control characters are flattened to
 * single spaces and HTML-significant chars escaped like message content.
 * Blank titles keep the generic heading byte-identical to before. */
function exportHeading(rawTitle: string | undefined): string {
  return escapeHtml(exportTitleText(rawTitle));
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

/** P180 — whether a finished bubble carries no usable reply text. */
function unusableAssistant(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    (Boolean(message.error) || message.content.trim().length === 0)
  );
}

/** P180 — plain-text placeholder for a failed/stopped/empty assistant
 * bubble; the Markdown renderer wraps it in a blockquote, the JSON export
 * carries it verbatim as `content` (P181). */
function unusablePlaceholder(message: ChatMessage): string {
  const detail =
    (message.errorDetail ?? '').trim() ||
    (message.error ? message.content.trim() : '');
  return detail
    ? `（此条回复生成失败或已停止：${detail}）`
    : '（此条回复生成失败或已停止）';
}

/** P180 — the body line for one exported bubble. A non-streaming assistant
 * bubble with nothing usable (error flag, or empty/whitespace content)
 * becomes a single blockquote placeholder instead of being dropped; every
 * other bubble renders exactly as before. */
function exportBodyLine(message: ChatMessage): string {
  if (!unusableAssistant(message)) {
    return escapeHtml(message.content.trimEnd());
  }
  return `> ${escapeHtml(unusablePlaceholder(message))}`;
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

/** P181 — machine-readable export shape: one entry per exported bubble. */
export interface ConversationJsonMessage {
  role: 'user' | 'assistant';
  /** ISO-8601 with UTC offset; null when the bubble has no usable time. */
  createdAt: string | null;
  content: string;
  toolEvents: ToolEvent[];
}

export interface ConversationJsonExport {
  title: string;
  /** ISO-8601 with UTC offset. */
  exportedAt: string;
  messages: ConversationJsonMessage[];
}

/** P181 — the `content` for one JSON row: the same text the Markdown body
 * carries, minus markup — normal bubbles keep their trimmed text verbatim
 * (JSON is data, not HTML, so no escaping) and failed/empty assistant
 * bubbles carry the same placeholder text instead of being dropped. */
function exportMessageContent(message: ChatMessage): string {
  return unusableAssistant(message)
    ? unusablePlaceholder(message)
    : message.content.trimEnd();
}

/** P181 — machine-readable export of the same bubbles the Markdown export
 * covers (`exportableMessages`), as `{ title, exportedAt, messages }` JSON. */
export function buildConversationJson(
  messages: ChatMessage[],
  options: ExportOptions = {},
): string {
  const { exportedAt = Date.now() } = options;
  const payload: ConversationJsonExport = {
    title: exportTitleText(options.title),
    exportedAt: formatIsoOffset(exportedAt),
    messages: exportableMessages(messages).map((message) => {
      const time = messageTime(message);
      return {
        role: message.role,
        createdAt: time === null ? null : formatIsoOffset(time),
        content: exportMessageContent(message),
        toolEvents: message.toolEvents ?? [],
      };
    }),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function filenameStamp(now: number): string {
  const d = new Date(now);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

/** `datingagent-chat-20261114-1305.md`, or
 * `datingagent-chat-<title>-20261114-1305.md` when a usable title is given. */
export function conversationFilename(now: number = Date.now(), title?: string): string {
  const stamp = filenameStamp(now);
  const part = title ? sanitizeFilenamePart(title) : '';
  return part
    ? `datingagent-chat-${part}-${stamp}.md`
    : `datingagent-chat-${stamp}.md`;
}

/** P181 — same naming as `conversationFilename` with a `.json` extension. */
export function conversationJsonFilename(
  now: number = Date.now(),
  title?: string,
): string {
  const stamp = filenameStamp(now);
  const part = title ? sanitizeFilenamePart(title) : '';
  return part
    ? `datingagent-chat-${part}-${stamp}.json`
    : `datingagent-chat-${stamp}.json`;
}

/** Trigger a client-side download. Returns false if the Blob/anchor path fails. */
function downloadTextFile(content: string, filename: string, mimeType: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;

  let url: string | null = null;
  try {
    const blob = new Blob([content], { type: mimeType });
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

/** Download a Markdown export. Returns false if the Blob/anchor path fails. */
export function downloadMarkdown(markdown: string, filename: string): boolean {
  return downloadTextFile(markdown, filename, 'text/markdown;charset=utf-8');
}

/** P181 — download a JSON export through the same Blob/anchor path. */
export function downloadJson(json: string, filename: string): boolean {
  return downloadTextFile(json, filename, 'application/json;charset=utf-8');
}
