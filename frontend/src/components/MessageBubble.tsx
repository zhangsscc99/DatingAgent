import { Children, isValidElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { ChatMessage } from '../types';
import { copyText } from '../lib/clipboard';
import { highlightSegments } from '../lib/messageSearch';
import { normalizeMarkdownTables } from '../lib/markdownTables';
import { fillBracketSlots } from '../lib/replyPlaceholders';
import { replyCollapseReason, shouldCollapseReply, visibleReplyContent } from '../lib/replyCollapse';
import {
  formatLatencySeconds,
  formatRelativeTime,
  isRenderableTimestamp,
} from '../lib/relativeTime';
import { formatAbsolute } from '../lib/absoluteTime';
import {
  GENERATION_PROGRESS_WRITING,
  generationProgressLabel,
} from '../lib/generationProgress';
import {
  DUPLICATE_REGEN_HINT,
  DUPLICATE_REGEN_RETRY_LABEL,
} from '../lib/regenerateDedupe';
import StreamingIndicator from './StreamingIndicator';
import ToolBadge from './ToolBadge';
import './MessageBubble.css';

interface Props {
  message: ChatMessage;
  onRetry?: (messageId: string, prompt: string) => void;
  /** P26: offered only on the newest assistant bubble; regenerates in place. */
  onRegenerate?: (messageId: string) => void;
  /** P276: swap the displayed reply with the version 换一个 parked. */
  onToggleReplyVersion?: (messageId: string) => void;
  /** True while a request is in flight — disables the regenerate action. */
  busy?: boolean;
  /** P19: normalized search keyword — marks hits in user bubbles, flags assistant ones. */
  highlightQuery?: string;
  /** P192: elapsed-time text for the streaming placeholder (first token still in flight). */
  waitingLabel?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_MS = 1500;

/**
 * P235 — the model wraps one-line sample phrasing in `> …`, and a full-width
 * blockquote for a single sentence reads like a manual excerpt. A quote made
 * of exactly one paragraph with no line break downgrades to a normal
 * paragraph carrying the inline-quote style; multi-line quotes keep the
 * blockquote rendering.
 */
function quoteText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return quoteText(child.props.children);
      return '';
    })
    .join('');
}

function singleLineQuoteParagraph(children: ReactNode): ReactElement<{ children?: ReactNode }> | null {
  const blocks = Children.toArray(children).filter(
    (child) => typeof child !== 'string' || child.trim() !== '',
  );
  if (blocks.length !== 1) return null;
  const only = blocks[0];
  if (!isValidElement<{ children?: ReactNode }>(only) || only.type !== 'p') return null;
  if (quoteText(only.props.children).includes('\n')) return null;
  return only;
}

const markdownComponents: Components = {
  blockquote({ children }) {
    const single = singleLineQuoteParagraph(children);
    return single ? (
      <p className="inline-quote">{single.props.children}</p>
    ) : (
      <blockquote>{children}</blockquote>
    );
  },
};

function MessageBubble({ message, onRetry, onRegenerate, onToggleReplyVersion, busy = false, highlightQuery, waitingLabel }: Props) {
  const isUser = message.role === 'user';
  // P334: a template slot that survived the backend pass (「看那个[某部电影/展]」)
  // must still never reach the DOM — render/copy the rewritten text instead.
  const bodyText = isUser ? message.content : fillBracketSlots(message.content);
  // Assistant bubbles render through ReactMarkdown, so the whole bubble is
  // flagged instead of marking inline hits (P19).
  const searchHit =
    !isUser &&
    !!highlightQuery &&
    bodyText.toLowerCase().includes(highlightQuery.toLowerCase());
  const showStreamingIndicator =
    !isUser && message.streaming && !message.content && message.streamPhase;
  const showCursor = !isUser && message.streaming && !!message.content && !message.error;
  // P272: a quiet progress signal for the whole pending window —
  // undefined the instant `streaming` flips off. P318: the in-stream line
  // paints GENERATION_PROGRESS_WRITING, not the raw character count.
  const progressLabel = generationProgressLabel(bodyText.length, !isUser && !!message.streaming);

  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<number | null>(null);
  // P217: long replies start collapsed; a regenerated bubble starts fresh.
  const [replyExpanded, setReplyExpanded] = useState(false);
  useEffect(() => setReplyExpanded(false), [message.id]);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(bodyText);
    clearResetTimer();
    setCopyState(ok ? 'copied' : 'failed');
    resetTimer.current = window.setTimeout(() => {
      setCopyState('idle');
      resetTimer.current = null;
    }, COPY_FEEDBACK_MS);
  }, [clearResetTimer, bodyText]);

  // P304: user bubbles never offer 复制 — copying a sentence you just sent
  // is meaningless and the pill stretched the pink bubble taller.
  const canCopy =
    !isUser && !message.streaming && !message.error && bodyText.trim().length > 0;

  // P197: GFM pipe tables degrade to bullet lists — react-markdown has no
  // remark-gfm, so raw `|---|` rows would collapse into pipe soup.
  let markdownContent = isUser ? bodyText : normalizeMarkdownTables(bodyText);

  // P217: settled assistant replies past the limit collapse to a preview;
  // expanding swaps in the full text without touching the scroll position.
  const collapsible =
    !isUser && !message.streaming && !message.error && shouldCollapseReply(bodyText);
  // P301: a >3-paragraph reply collapses even under the char limit — its
  // toggle reads 「展开更多」; the char-only path keeps 「展开全文」.
  const paragraphCollapsed =
    collapsible && replyCollapseReason(bodyText) === 'paragraphs';
  if (collapsible && !replyExpanded) {
    markdownContent = normalizeMarkdownTables(visibleReplyContent(bodyText, false));
  }

  const canRegen =
    !isUser &&
    !message.streaming &&
    !message.regenerating &&
    !message.error &&
    typeof onRegenerate === 'function';

  const handleRegenerate = useCallback(() => {
    onRegenerate?.(message.id);
  }, [onRegenerate, message.id]);

  // P276: after 换一个 the outgoing reply sits in previousVersion (the
  // bubble shows the newest text → offer 恢复上一版); once restored, the
  // newer reply parks in newerVersion instead → offer 查看新版. The control
  // only exists while one of the two slots is populated, and never on a
  // bubble that is streaming/regenerating/errored.
  const viewingPrevious = message.newerVersion !== undefined;
  // P332: 「第 N 版」 counts generations from 1; the first version wears no
  // label at all, so only a bumped/restored index renders the badge.
  const versionIndex = message.versionIndex ?? 1;
  const showVersionBadge = !isUser && versionIndex > 1;
  const canToggleVersion =
    !isUser &&
    !message.streaming &&
    !message.regenerating &&
    !message.error &&
    typeof onToggleReplyVersion === 'function' &&
    (message.previousVersion !== undefined || viewingPrevious);

  const handleToggleVersion = useCallback(() => {
    onToggleReplyVersion?.(message.id);
  }, [onToggleReplyVersion, message.id]);

  // P329: the meta row's age label becomes a real <time> so hover/long-press
  // surfaces the absolute date and machines get an ISO stamp. A corrupt
  // timestamp yields '' — the old 刚刚 <span> renders instead, so no empty
  // title attribute ever reaches the DOM.
  const createdAt = message.createdAt;
  const createdAtAbsolute = formatAbsolute(createdAt);
  const createdAtIso = isRenderableTimestamp(createdAt)
    ? new Date(createdAt).toISOString()
    : '';

  const showReplyMeta =
    !isUser &&
    !message.streaming &&
    !message.error &&
    !message.duplicateRegen &&
    typeof message.meta?.tokens === 'number';

  /* P331: the age label used to sit under the action pills as a third bottom
     line (body → buttons → time). It now rides inside .bubble-actions as the
     row's first item — one 「刚刚 · 复制 · 换一个」 line. When no action row
     renders it still appears on its own line under the body. */
  const replyMeta = showReplyMeta ? (
    <div
      className="reply-meta"
      aria-hidden="true"
      title={
        typeof message.meta?.latencyMs === 'number'
          ? `${message.meta.tokens} tokens · ${formatLatencySeconds(message.meta.latencyMs)}`
          : `${message.meta?.tokens} tokens`
      }
    >
      {/* P304: the 「约 X 秒」 badge leaves the body visual hierarchy —
          the row shows the reply's age (「刚刚」 right after it lands)
          while the exact seconds + tokens live only in the title. */}
      {createdAtAbsolute ? (
        <time dateTime={createdAtIso} title={createdAtAbsolute}>
          {formatRelativeTime(message.createdAt)}
        </time>
      ) : (
        <span>刚刚</span>
      )}
    </div>
  ) : null;

  return (
    <div
      className={`bubble-row animate-in ${isUser ? 'user' : 'assistant'}${message.error ? ' error' : ''}`}
      data-message-id={message.id}
      role="group"
      aria-label={isUser ? '你的消息' : 'DatingAgent 的回复'}
    >
      {!isUser && (
        <div className="avatar" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      )}
      <div
        className={`bubble ${isUser ? 'user' : 'assistant'}${message.error ? ' error' : ''}${searchHit ? ' search-match' : ''}`}
        data-search-match={searchHit ? 'true' : undefined}
      >
        {message.toolEvents && message.toolEvents.length > 0 && (
          <div className="tool-events">
            {message.toolEvents.map((t, i) => (
              <ToolBadge key={`${t.name}-${i}`} event={t} />
            ))}
          </div>
        )}
        <div className="bubble-content">
          {isUser ? (
            highlightQuery ? (
              highlightSegments(message.content, highlightQuery).map((segment, i) =>
                segment.hit ? (
                  <mark key={i} className="match">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={i}>{segment.text}</span>
                ),
              )
            ) : (
              message.content
            )
          ) : showStreamingIndicator ? (
            <StreamingIndicator
              phase={message.streamPhase!}
              // P272: fold the progress copy into the single label slot so
              // the placeholder never shows two overlapping thinking texts.
              label={
                waitingLabel && progressLabel
                  ? `${progressLabel} · ${waitingLabel}`
                  : (progressLabel ?? waitingLabel)
              }
            />
          ) : (
            <>
              {bodyText && (
                <div className={message.streaming ? 'markdown-streaming' : undefined}>
                  <ReactMarkdown components={markdownComponents}>{markdownContent}</ReactMarkdown>
                </div>
              )}
              {showCursor && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
        </div>
        {progressLabel && bodyText.length > 0 && (
          <div className="generation-progress" aria-hidden="true">
            <span>{GENERATION_PROGRESS_WRITING}</span>
            <span className="streaming-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        {collapsible && (
          <button
            type="button"
            className="collapse-toggle"
            onClick={() => setReplyExpanded((v) => !v)}
            aria-expanded={replyExpanded}
            aria-label={
              replyExpanded
                ? '收起回复全文'
                : paragraphCollapsed
                  ? '展开更多回复段落'
                  : '展开回复全文'
            }
            title={
              replyExpanded ? '收起' : paragraphCollapsed ? '展开更多' : '展开全文'
            }
          >
            {paragraphCollapsed ? (
              replyExpanded ? '收起' : '展开更多'
            ) : (
              <>{replyExpanded ? '收起' : '展开全文'}</>
            )}
          </button>
        )}
        {message.stopped && (
          <div className="stopped-note" role="status">
            已停止生成
          </div>
        )}
        {message.regenerating && (
          <div className="regen-status" role="status" aria-live="polite">
            正在重新生成…
          </div>
        )}
        {message.error && message.errorDetail && (
          <div className="bubble-error-detail">{message.errorDetail}</div>
        )}
        {message.error && message.retryPrompt && onRetry && (
          <button
            type="button"
            className="retry-btn"
            onClick={() => onRetry(message.id, message.retryPrompt!)}
            aria-label="重试上一条消息"
            title="重新发送上一条消息（不会重复添加）"
          >
            ↻ 重试
          </button>
        )}
        {(canCopy || canRegen) && (
          <div className="bubble-actions">
            {replyMeta}
            {canCopy && (
              <button
                type="button"
                className={`copy-btn${copyState === 'copied' ? ' copied' : ''}${
                  copyState === 'failed' ? ' failed' : ''
                }`}
                onClick={handleCopy}
                aria-label={copyState === 'copied' ? '已复制' : '复制回复'}
                title={
                  copyState === 'failed' ? '复制失败，请手动选择文本' : '复制回复'
                }
              >
                {copyState === 'copied' ? (
                  '✓ 已复制'
                ) : copyState === 'failed' ? (
                  '复制失败'
                ) : (
                  <>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    {'复制'}
                  </>
                )}
              </button>
            )}
            {canRegen && (
              <button
                type="button"
                className="regen-btn"
                onClick={handleRegenerate}
                disabled={busy}
                aria-label="重新生成回复"
                title="换一个回复"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                {'换一个'}
              </button>
            )}
            {canToggleVersion && (
              <button
                type="button"
                className="regen-btn version-toggle"
                onClick={handleToggleVersion}
                disabled={busy}
                aria-label={viewingPrevious ? '查看新版回复' : '恢复上一版回复'}
                title={viewingPrevious ? '查看新版回复' : '恢复上一版回复'}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {viewingPrevious ? (
                    <>
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </>
                  ) : (
                    <>
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </>
                  )}
                </svg>
                {viewingPrevious ? '查看新版' : '恢复上一版'}
              </button>
            )}
            {showVersionBadge && (
              <span className="version-badge" aria-label={`当前为第 ${versionIndex} 版回复`}>
                {`第 ${versionIndex} 版`}
              </span>
            )}
            <span className="copy-status" role="status" aria-live="polite">
              {copyState === 'copied' ? '已复制到剪贴板' : copyState === 'failed' ? '复制失败' : ''}
            </span>
          </div>
        )}
        {/* P284: a 「换一个」 that came back identical keeps the original
            text but must not wear a fresh 约 X 秒 badge — the honest retry
            line replaces the meta row. */}
        {!isUser && !message.streaming && !message.error && message.duplicateRegen && (
          <div className="duplicate-note" role="status">
            <span>{DUPLICATE_REGEN_HINT}</span>
            <button
              type="button"
              className="duplicate-retry-btn"
              onClick={handleRegenerate}
              disabled={busy || !canRegen}
              aria-label="再试一次，换一个不同的回复"
              title="再试一次，换一个不同的回复"
            >
              {DUPLICATE_REGEN_RETRY_LABEL}
            </button>
          </div>
        )}
        {!(canCopy || canRegen) && replyMeta}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
