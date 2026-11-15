import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../types';
import { copyText } from '../lib/clipboard';
import StreamingIndicator from './StreamingIndicator';
import ToolBadge from './ToolBadge';
import './MessageBubble.css';

interface Props {
  message: ChatMessage;
  onRetry?: (messageId: string, prompt: string) => void;
  /** P26: offered only on the newest assistant bubble; regenerates in place. */
  onRegenerate?: (messageId: string) => void;
  /** True while a request is in flight — disables the regenerate action. */
  busy?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_MS = 1500;

function MessageBubble({ message, onRetry, onRegenerate, busy = false }: Props) {
  const isUser = message.role === 'user';
  const showStreamingIndicator =
    !isUser && message.streaming && !message.content && message.streamPhase;
  const showCursor = !isUser && message.streaming && !!message.content && !message.error;

  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<number | null>(null);

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
    !isUser && !message.streaming && !message.error && message.content.trim().length > 0;

  const canRegen =
    !isUser &&
    !message.streaming &&
    !message.regenerating &&
    !message.error &&
    typeof onRegenerate === 'function';

  const handleRegenerate = useCallback(() => {
    onRegenerate?.(message.id);
  }, [onRegenerate, message.id]);

  return (
    <div
      className={`bubble-row animate-in ${isUser ? 'user' : 'assistant'}${message.error ? ' error' : ''}`}
      role="group"
      aria-label={isUser ? '你的消息' : 'DatingAgent 的回复'}
    >
      {!isUser && (
        <div className="avatar" aria-hidden="true">
          🌹
        </div>
      )}
      <div className={`bubble ${isUser ? 'user' : 'assistant'}${message.error ? ' error' : ''}`}>
        {message.toolEvents && message.toolEvents.length > 0 && (
          <div className="tool-events">
            {message.toolEvents.map((t, i) => (
              <ToolBadge key={`${t.name}-${i}`} event={t} />
            ))}
          </div>
        )}
        <div className="bubble-content">
          {isUser ? (
            message.content
          ) : showStreamingIndicator ? (
            <StreamingIndicator phase={message.streamPhase!} />
          ) : (
            <>
              {message.content && (
                <div className={message.streaming ? 'markdown-streaming' : undefined}>
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              )}
              {showCursor && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
        </div>
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
                aria-label={copyState === 'copied' ? '已复制' : '复制回复'}
                title={copyState === 'failed' ? '复制失败，请手动选择文本' : '复制回复'}
              >
                {copyState === 'copied' ? '✓ 已复制' : copyState === 'failed' ? '复制失败' : '⧉ 复制'}
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
                ↻ 换一个
              </button>
            )}
            <span className="copy-status" role="status" aria-live="polite">
              {copyState === 'copied' ? '已复制到剪贴板' : copyState === 'failed' ? '复制失败' : ''}
            </span>
          </div>
        )}
        {!isUser && !message.streaming && !message.error && typeof message.meta?.tokens === 'number' && (
          <div className="reply-meta" aria-hidden="true">
            {message.meta.tool && (
              <span className="reply-meta-tool">{message.meta.tool}</span>
            )}
            <span>{message.meta.tokens} tokens</span>
            {typeof message.meta.latencyMs === 'number' && (
              <span>{(message.meta.latencyMs / 1000).toFixed(1)}s</span>
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
