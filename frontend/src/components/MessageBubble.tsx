import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../types';
import StreamingIndicator from './StreamingIndicator';
import ToolBadge from './ToolBadge';
import './MessageBubble.css';

interface Props {
  message: ChatMessage;
  onRetry?: (messageId: string, prompt: string) => void;
}

function MessageBubble({ message, onRetry }: Props) {
  const isUser = message.role === 'user';
  const showStreamingIndicator =
    !isUser && message.streaming && !message.content && message.streamPhase;
  const showCursor = !isUser && message.streaming && !!message.content && !message.error;

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
      </div>
      {isUser && <div className="avatar user-avatar">你</div>}
    </div>
  );
}

export default memo(MessageBubble);
