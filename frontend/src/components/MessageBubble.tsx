import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '../types';
import ToolBadge from './ToolBadge';
import './MessageBubble.css';

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`bubble-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <div className="avatar">🌹</div>}
      <div className={`bubble ${isUser ? 'user' : 'assistant'}`}>
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
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
        </div>
      </div>
      {isUser && <div className="avatar user-avatar">你</div>}
    </div>
  );
}
