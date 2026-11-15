import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, UserProfile } from '../types';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import SessionSkeleton from './SessionSkeleton';
import './ChatWindow.css';

/** F15: smooth scrolling is motion; honour the OS preference. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** P24: how far from the latest message before the jump button appears. */
const SCROLL_BOTTOM_THRESHOLD = 150;

/** F20: empty-state starter prompts; clicking one prefills the composer. */
const STARTER_PROMPTS = [
  { label: '资料优化', prompt: '帮我优化一下我的个人资料' },
  { label: '聊天指导', prompt: '对方回复很冷淡，我该怎么继续聊？' },
  { label: '约会规划', prompt: '帮我规划一次第一次约会' },
];

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  restoring?: boolean;
  profile?: UserProfile | null;
  sessionId?: string | null;
  onSend: (text: string) => void;
  onRetry?: (messageId: string, prompt: string) => void;
  onSetupProfile?: () => void;
}

export default function ChatWindow({
  messages,
  loading,
  restoring = false,
  profile,
  sessionId,
  onSend,
  onRetry,
  onSetupProfile,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarHandle>(null);
  const wasRestoring = useRef(false);
  const wasLoading = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [messages, loading]);

  // P24: reveal the jump button once the user scrolls well above the latest
  // message; hide it again near the bottom.
  const handleMessagesScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setShowScrollToBottom(
      el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_BOTTOM_THRESHOLD,
    );
  };

  const scrollToLatest = () => {
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  useEffect(() => {
    if (wasRestoring.current && !restoring) {
      inputRef.current?.focus();
    }
    wasRestoring.current = restoring;
  }, [restoring]);

  // P48: when a reply finishes, hand focus back to the composer — unless the
  // user has moved into another field or a modal is open.
  useEffect(() => {
    const was = wasLoading.current;
    wasLoading.current = loading;
    if (!was || loading || restoring) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && el.id !== 'chat-input') {
      if (el.closest('[aria-modal="true"]')) return;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return;
    }
    inputRef.current?.focus();
  }, [loading, restoring]);

  return (
    <div className="chat-window">
      <div className="messages-wrap">
        <div
          ref={listRef}
          className="messages"
          role="log"
          aria-busy={restoring || loading}
          onScroll={handleMessagesScroll}
        >
        {restoring && <SessionSkeleton />}

        {!restoring && messages.length === 0 && (
          <div className="welcome animate-in">
            <div className="welcome-icon" aria-hidden="true">
              🌹
            </div>
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
            <div className="starter-chips" role="group" aria-label="开始话题">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="starter-chip"
                  aria-label={p.label}
                  onClick={() => inputRef.current?.prefill(p.prompt)}
                >
                  {p.label}
                </button>
              ))}
            </div>
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
          messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              // Only the newest bubble can be retried; retrying an older turn
              // would append the reply out of order.
              onRetry={index === messages.length - 1 ? onRetry : undefined}
            />
          ))}

          <div ref={bottomRef} />
        </div>

        {showScrollToBottom && (
          <button
            type="button"
            className="scroll-to-bottom"
            aria-label="滚动到底部"
            onClick={scrollToLatest}
          >
            ↑
          </button>
        )}
      </div>

      <InputBar
        ref={inputRef}
        onSend={onSend}
        disabled={loading || restoring}
        draftKey={sessionId ?? 'default'}
      />
    </div>
  );
}
