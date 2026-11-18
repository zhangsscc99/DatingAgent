import { Children, isValidElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { ChatMessage } from '../types';
import { copyText } from '../lib/clipboard';
import { highlightSegments } from '../lib/messageSearch';
import { normalizeMarkdownTables } from '../lib/markdownTables';
import { shouldCollapseReply, visibleReplyContent } from '../lib/replyCollapse';
import { formatLatencySeconds, formatReplyLatency } from '../lib/relativeTime';
import { generationProgressLabel } from '../lib/generationProgress';
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
  // Assistant bubbles render through ReactMarkdown, so the whole bubble is
  // flagged instead of marking inline hits (P19).
  const searchHit =
    !isUser &&
    !!highlightQuery &&
    message.content.toLowerCase().includes(highlightQuery.toLowerCase());
  const showStreamingIndicator =
    !isUser && message.streaming && !message.content && message.streamPhase;
  const showCursor = !isUser && message.streaming && !!message.content && !message.error;
  // P272: a quiet 「已生成 N 字」/「正在组织答案」 signal for the whole
  // pending window — undefined the instant `streaming` flips off.
  const progressLabel = generationProgressLabel(message.content.length, !isUser && !!message.streaming);

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
    const ok = await copyText(message.content);
    clearResetTimer();
    setCopyState(ok ? 'copied' : 'failed');
    resetTimer.current = window.setTimeout(() => {
      setCopyState('idle');
      resetTimer.current = null;
    }, COPY_FEEDBACK_MS);
  }, [clearResetTimer, message.content]);

  const canCopy =
    !message.streaming && !message.error && message.content.trim().length > 0;

  // P197: GFM pipe tables degrade to bullet lists — react-markdown has no
  // remark-gfm, so raw `|---|` rows would collapse into pipe soup.
  let markdownContent = isUser ? message.content : normalizeMarkdownTables(message.content);

  // P217: settled assistant replies past the limit collapse to a preview;
  // expanding swaps in the full text without touching the scroll position.
  const collapsible =
    !isUser && !message.streaming && !message.error && shouldCollapseReply(message.content);
  if (collapsible && !replyExpanded) {
    markdownContent = normalizeMarkdownTables(visibleReplyContent(message.content, false));
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
              {message.content && (
                <div className={message.streaming ? 'markdown-streaming' : undefined}>
                  <ReactMarkdown components={markdownComponents}>{markdownContent}</ReactMarkdown>
                </div>
              )}
              {showCursor && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
        </div>
        {progressLabel && message.content.length > 0 && (
          <div className="generation-progress" aria-hidden="true">
            {progressLabel}
          </div>
        )}
        {collapsible && (
          <button
            type="button"
            className="collapse-toggle"
            onClick={() => setReplyExpanded((v) => !v)}
            aria-expanded={replyExpanded}
            aria-label={replyExpanded ? '收起回复全文' : '展开回复全文'}
            title={replyExpanded ? '收起' : '展开全文'}
          >
            {replyExpanded ? '收起' : '展开全文'}
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
            {canCopy && (
              <button
                type="button"
                className={`copy-btn${copyState === 'copied' ? ' copied' : ''}${
                  copyState === 'failed' ? ' failed' : ''
                }`}
                onClick={handleCopy}
                aria-label={
                  copyState === 'copied' ? '已复制' : isUser ? '复制我的消息' : '复制回复'
                }
                title={
                  copyState === 'failed'
                    ? '复制失败，请手动选择文本'
                    : isUser
                      ? '复制我的消息'
                      : '复制回复'
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
        {!isUser && !message.streaming && !message.error && !message.duplicateRegen && typeof message.meta?.tokens === 'number' && (
          <div
            className="reply-meta"
            aria-hidden="true"
            title={
              typeof message.meta.latencyMs === 'number'
                ? `${message.meta.tokens} tokens · ${formatLatencySeconds(message.meta.latencyMs)}`
                : `${message.meta.tokens} tokens`
            }
          >
            {typeof message.meta.latencyMs === 'number' && (
              <span>{formatReplyLatency(message.meta.latencyMs)}</span>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="avatar user-avatar" aria-hidden="true">
          你
        </div>
      )}
    </div>
  );
}

export default memo(MessageBubble);
