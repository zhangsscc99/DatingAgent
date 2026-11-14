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
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_FEEDBACK_MS = 1500;

function MessageBubble({ message, onRetry }: Props) {
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

  return (
    <div
      className={`bubble-row animate-in ${isUser ? 'user' : 'assistant'}${message.error ? ' error' : ''}`}
    >
      {!isUser && <div className="avatar">🌹</div>}
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
        {message.error && message.retryPrompt && onRetry && (
          <button
            type="button"
            className="retry-btn"
            onClick={() => onRetry(message.id, message.retryPrompt!)}
          >
            ↻ 重试
          </button>
        )}
        {canCopy && (
          <div className="bubble-actions">
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
            <span className="copy-status" role="status" aria-live="polite">
              {copyState === 'copied' ? '已复制到剪贴板' : copyState === 'failed' ? '复制失败' : ''}
            </span>
          </div>
        )}
      </div>
      {isUser && <div className="avatar user-avatar">你</div>}
    </div>
  );
}

export default memo(MessageBubble);
