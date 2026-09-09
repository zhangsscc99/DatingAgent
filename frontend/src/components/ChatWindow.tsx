import { useEffect, useRef } from 'react';
import type { ChatMessage, UserProfile } from '../types';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import SessionSkeleton from './SessionSkeleton';
import './ChatWindow.css';

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  restoring?: boolean;
  profile?: UserProfile | null;
  onSend: (text: string) => void;
  onRetry?: (messageId: string, prompt: string) => void;
  onSetupProfile?: () => void;
}

export default function ChatWindow({
  messages,
  loading,
  restoring = false,
  profile,
  onSend,
  onRetry,
  onSetupProfile,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarHandle>(null);
  const wasRestoring = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (wasRestoring.current && !restoring) {
      inputRef.current?.focus();
    }
    wasRestoring.current = restoring;
  }, [restoring]);

  return (
    <div className="chat-window">
      <div className="messages" aria-busy={restoring || loading}>
        {restoring && <SessionSkeleton />}

        {!restoring && messages.length === 0 && (
          <div className="welcome animate-in">
            <div className="welcome-icon">🌹</div>
            <h2>
              {profile?.name ? `你好，${profile.name}！` : '你好，我是 DatingAgent'}
            </h2>
            <p>
              {profile?.goals
                ? `我会根据你的目标「${profile.goals}」给出专属建议。`
                : '专业的 AI 恋爱关系顾问，基于 Agent Harness 架构驱动。'}
            </p>
            {profile?.interests && profile.interests.length > 0 && (
              <div className="welcome-tags">
                {profile.interests.map((tag) => (
                  <span key={tag} className="welcome-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {!profile?.name && onSetupProfile && (
              <button type="button" className="welcome-cta" onClick={onSetupProfile}>
                完善资料，获得更个性化建议 →
              </button>
            )}
            <div className="welcome-features">
              <div className="feature">
                <span aria-hidden="true">🔧</span>
                <div>
                  <strong>Tool-calling Loop</strong>
                  <p>自动调用专业工具分析你的问题</p>
                </div>
              </div>
              <div className="feature">
                <span aria-hidden="true">💬</span>
                <div>
                  <strong>真诚沟通</strong>
                  <p>拒绝 PUA 套路，倡导共情与边界感</p>
                </div>
              </div>
              <div className="feature">
                <span aria-hidden="true">📊</span>
                <div>
                  <strong>结构化输出</strong>
                  <p>资料优化、聊天指导、约会规划一应俱全</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!restoring &&
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRetry={onRetry} />
          ))}

        <div ref={bottomRef} />
      </div>

      <InputBar ref={inputRef} onSend={onSend} disabled={loading || restoring} />
    </div>
  );
}
