import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, UserProfile } from '../types';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import SessionSkeleton from './SessionSkeleton';
import ChatSearchBar from './ChatSearchBar';
import ErrorToast from './ErrorToast';
import { DEFAULT_DRAFT_ID } from '../lib/chatDrafts';
import {
  EMPTY_CHAT_SEARCH,
  regenerableMessageId,
  resetSearchOnSessionChange,
  retryableMessageId,
} from '../lib/chatSearchState';
import { isSearching, matchMessages, normalizeQuery } from '../lib/messageSearch';
import { canGenerateReply, needsReply } from '../lib/pendingReply';
import { hasInteracted } from '../lib/interactionState';
import type { ErrorToastState } from '../lib/errorToast';
import type { RateLimitBudget } from '../lib/rateLimitStatus';
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
  /** P192: elapsed-time placeholder text while the reply's first token is in flight. */
  waitingLabel?: string;
  restoring?: boolean;
  profile?: UserProfile | null;
  sessionId?: string | null;
  onSend: (text: string) => void;
  /** P12: abort the in-flight streamed reply. */
  onStop?: () => void;
  onRetry?: (messageId: string, prompt: string) => void;
  /** P26: regenerate the newest assistant reply in place. */
  onRegenerate?: (messageId: string) => void;
  /** P161: resume an interrupted turn — answer a trailing user bubble. */
  onGenerateReply?: () => void;
  onSetupProfile?: () => void;
  /** P07: last known request budget from chat response headers (null until the first response). */
  rateLimit?: RateLimitBudget | null;
  /** P154: true while the browser reports no network — shows a dim line above the composer. */
  offline?: boolean;
  /** P17: transient error toast over the message list (null = hidden). */
  errorToast?: ErrorToastState | null;
  onToastRetry?: () => void;
  onToastDismiss?: () => void;
}

export default function ChatWindow({
  messages,
  loading,
  waitingLabel,
  restoring = false,
  profile,
  sessionId,
  onSend,
  onStop,
  onRetry,
  onRegenerate,
  onGenerateReply,
  onSetupProfile,
  rateLimit = null,
  offline = false,
  errorToast = null,
  onToastRetry,
  onToastDismiss,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarHandle>(null);
  const wasRestoring = useRef(false);
  const wasLoading = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // P19: client-side search over the rendered conversation.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const prevSessionId = useRef<string | null | undefined>(undefined);

  const normalizedQuery = normalizeQuery(query);
  const searching = searchOpen && isSearching(query);
  const matches = matchMessages(messages, query);
  const matchCount = matches.length;
  const renderedMessages = searching ? matches : messages;
  const activeMatch = matchCount === 0 ? 0 : Math.min(activeIndex, matchCount - 1);
  // P162: retry/regenerate act on the true tail of `messages`, never on the
  // filtered search view — bind by id so hidden turns keep no dead buttons.
  const retryableId = retryableMessageId(messages);
  const regenerableId = regenerableMessageId(messages);

  // P162: ChatWindow has no per-session key, so a search left open in one
  // conversation would keep filtering the next and hide its messages. Reset
  // on session change; the first mount is skipped — state starts empty.
  useEffect(() => {
    const prev = prevSessionId.current;
    prevSessionId.current = sessionId ?? null;
    if (prev === undefined) return;
    const next = resetSearchOnSessionChange(
      { open: searchOpen, query, activeIndex },
      prev,
      sessionId ?? null,
    );
    if (next === EMPTY_CHAT_SEARCH) {
      setSearchOpen(next.open);
      setQuery(next.query);
      setActiveIndex(next.activeIndex);
    }
  }, [sessionId, searchOpen, query, activeIndex]);

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

  // P19: clamp the focused match when the result set shrinks or empties.
  useEffect(() => {
    setActiveIndex((i) => (matchCount === 0 ? 0 : Math.min(i, matchCount - 1)));
  }, [matchCount]);

  // P19: keep the focused match in view while stepping through results.
  const activeMatchId = searching && matchCount > 0 ? matches[activeMatch].id : null;
  useEffect(() => {
    if (!activeMatchId) return;
    const row = listRef.current?.querySelector(
      `[data-message-id="${CSS.escape(activeMatchId)}"]`,
    );
    row?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeMatchId]);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    setActiveIndex(0);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  const nextMatch = () => {
    if (matchCount > 0) setActiveIndex((i) => (i + 1) % matchCount);
  };

  const prevMatch = () => {
    if (matchCount > 0) setActiveIndex((i) => (i - 1 + matchCount) % matchCount);
  };

  // P162: sending while the search bar is open would hide the new message
  // behind the stale filter — close search first so it appears immediately.
  const handleSend = (text: string) => {
    if (searchOpen) closeSearch();
    onSend(text);
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

  // P105: autofocus the composer once on first mount — skip for reduced-motion
  // users, open modals, small viewports, or when focus is already in a field.
  // P133: only after the user has interacted, so a cold load keeps the skip
  // link as the first Tab stop.
  useEffect(() => {
    if (!hasInteracted()) return;
    if (prefersReducedMotion()) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    if (window.matchMedia('(max-width: 640px)').matches) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-window">
      <div className="messages-wrap">
        {errorToast && (
          <ErrorToast
            text={errorToast.text}
            retrying={loading}
            onRetry={onToastRetry ?? (() => {})}
            onDismiss={onToastDismiss ?? (() => {})}
          />
        )}
        {!restoring && messages.length > 0 && !searchOpen && (
          <button
            type="button"
            className="search-toggle"
            aria-label="搜索对话"
            title="搜索当前对话"
            onClick={() => {
              setSearchOpen(true);
              setActiveIndex(0);
            }}
          >
            🔍
          </button>
        )}
        {searchOpen && (
          <ChatSearchBar
            query={query}
            matchCount={matchCount}
            activeIndex={activeMatch}
            onQueryChange={handleQueryChange}
            onNext={nextMatch}
            onPrev={prevMatch}
            onClose={closeSearch}
          />
        )}
        <div
          ref={listRef}
          className="messages"
          role="log"
          aria-busy={restoring || loading}
          onScroll={handleMessagesScroll}
        >
        {restoring && <SessionSkeleton />}

        {!restoring && searching && matchCount === 0 && (
          <div className="search-empty">没有找到包含「{query.trim()}」的消息</div>
        )}

        {!restoring && !searchOpen && messages.length === 0 && (
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
          renderedMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              busy={loading}
              // P192: only the streaming placeholder bubble gets the ticking
              // label — a constant undefined elsewhere keeps memo() intact.
              waitingLabel={
                msg.streaming && !msg.content && msg.streamPhase
                  ? waitingLabel
                  : undefined
              }
              highlightQuery={searching ? normalizedQuery : undefined}
              // Only the newest turn of the full conversation can be retried
              // or regenerated; anything older would append out of order.
              onRetry={msg.id === retryableId ? onRetry : undefined}
              onRegenerate={msg.id === regenerableId ? onRegenerate : undefined}
            />
          ))}

        {/* P161: an interrupted stream leaves a persisted user bubble with
            no reply; offer to finish the turn without retyping. Hidden the
            moment any assistant row (streaming or error) trails it, and
            while the filtered search view is active. */}
        {!restoring && !searching && onGenerateReply && needsReply(messages) && (
          <div className="pending-reply-row">
            <button
              type="button"
              className="pending-reply-btn"
              onClick={onGenerateReply}
              disabled={!canGenerateReply(messages, loading)}
              aria-label="生成回复"
              title="上次回复被中断，点击为这条消息生成回复"
            >
              ↻ 生成回复
            </button>
          </div>
        )}

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

      {offline && (
        <p className="offline-note" role="status">
          网络已断开，恢复后会自动重连
        </p>
      )}
      <InputBar
        ref={inputRef}
        onSend={handleSend}
        streaming={loading}
        onStop={onStop}
        disabled={loading || restoring}
        draftKey={sessionId ?? DEFAULT_DRAFT_ID}
        rateLimit={rateLimit}
      />
    </div>
  );
}
