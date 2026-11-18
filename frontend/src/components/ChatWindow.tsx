import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
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
import { isOnboardingComplete } from '../lib/profileStorage';
import { memoryReceiptLine } from '../lib/memoryReceipt';
import { hasInteracted } from '../lib/interactionState';
import type { ErrorToastState } from '../lib/errorToast';
import type { RateLimitBudget } from '../lib/rateLimitStatus';
import type { ReplyLengthPreference } from '../lib/replyLength';
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

type FeatureIconKey = 'wrench' | 'chat' | 'chart';

// P200: restrained inline SVGs (currentColor stroke) replace the emoji
// decoration on the welcome card; the text labels carry the meaning, so
// every icon is aria-hidden. Same pattern as the P199 SidebarIcon.
const FEATURE_ICON_PATHS: Record<FeatureIconKey, string[]> = {
  wrench: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
};

function FeatureIcon({ iconKey }: { iconKey: FeatureIconKey }) {
  return (
    <svg
      className="feature-icon"
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
      {FEATURE_ICON_PATHS[iconKey].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

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
  /** P276: swap a regenerated bubble between its newest and parked version. */
  onToggleReplyVersion?: (messageId: string) => void;
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
  /** P205: reply-length preference forwarded to the composer tool-row cycler. */
  replyLength?: ReplyLengthPreference;
  /** P205: the same setter the settings sheet uses — single source of truth. */
  onReplyLengthChange?: (next: ReplyLengthPreference) => void;
  /** P244: drafts queued to auto-send when the current reply ends. */
  queuedCount?: number;
  /** P244: drop the queue; returns the queued texts for composer restore. */
  onCancelQueue?: () => string[];
}

/** P206/P226: lets the header search toggle drive the in-conversation search
 * at every breakpoint — nothing floats over .messages-wrap anymore. */
export interface ChatWindowHandle {
  openSearch: () => void;
}

const ChatWindow = forwardRef<ChatWindowHandle, Props>(function ChatWindow({
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
  onToggleReplyVersion,
  onGenerateReply,
  onSetupProfile,
  rateLimit = null,
  offline = false,
  errorToast = null,
  onToastRetry,
  onToastDismiss,
  replyLength = 'default',
  onReplyLengthChange,
  queuedCount = 0,
  onCancelQueue,
}: Props, ref) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarHandle>(null);
  const wasRestoring = useRef(false);
  const wasLoading = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // P255: the one-line profile nudge above the composer is session-scoped —
  // dismissed once, it stays down until reload. Users who already saved or
  // skipped the profile prompt (onboardingDone) never see it, and a saved
  // profile removes it outright. Read in render like getLastEvictionNotice
  // so an in-session 稍后再说 suppresses it immediately.
  const [profileNudgeDismissed, setProfileNudgeDismissed] = useState(false);
  const profileNudgeVisible =
    !restoring &&
    !profile?.name &&
    !profileNudgeDismissed &&
    !isOnboardingComplete() &&
    messages.some(
      (m) =>
        m.role === 'assistant' &&
        !m.streaming &&
        !m.error &&
        m.content.length > 0,
    );

  // P293: the memory receipt — one quiet line pinned at the head of the
  // conversation naming what the agent already remembers (stored profile
  // fields, the reply-length preference). Nothing renders before a
  // conversation exists or while a session is still being restored, and
  // nothing renders when there is nothing remembered.
  const memoryReceipt =
    !restoring && messages.length > 0
      ? memoryReceiptLine(profile, replyLength)
      : null;

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

  // P206/P226: the single open path the header toggle calls at every
  // breakpoint (P226 removed the floating .search-toggle that covered the
  // first bubble at <1024px too).
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setActiveIndex(0);
  }, []);
  useImperativeHandle(ref, () => ({ openSearch }), [openSearch]);

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
      {memoryReceipt && (
        <p
          className="memory-receipt"
          title="来自你的资料与本对话的偏好设置"
        >
          {memoryReceipt}
        </p>
      )}
      <div className="messages-wrap">
        {errorToast && (
          <ErrorToast
            text={errorToast.text}
            retrying={loading}
            onRetry={onToastRetry ?? (() => {})}
            onDismiss={onToastDismiss ?? (() => {})}
          />
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
            <h2>
              {profile?.name ? `你好，${profile.name}！` : '你好，我是 DatingAgent'}
            </h2>
            <p>
              {profile?.goals ? (
                `我会根据你的目标「${profile.goals}」给出专属建议。`
              ) : (
                <>
                  懂分寸的恋爱顾问：先听你说完，再给一句能
                  <span className="hero-subtitle-nowrap">直接照着用</span>
                  的建议。
                </>
              )}
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
            {/* P290: the empty welcome screen gets exactly one brand-solid
                action — the hero CTA focuses the composer; every other
                control on this screen is an outline or text button so the
                eye has a single landing point. */}
            <button
              type="button"
              className="welcome-primary-cta"
              data-primary-cta
              onClick={() => inputRef.current?.focus()}
            >
              说说你的情况
            </button>
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
                <span aria-hidden="true">
                  <FeatureIcon iconKey="wrench" />
                </span>
                <div>
                  <strong>帮你把话说到点上</strong>
                  <p>该不该发、怎么发，给一个具体说法</p>
                </div>
              </div>
              <div className="feature">
                <span aria-hidden="true">
                  <FeatureIcon iconKey="chat" />
                </span>
                <div>
                  <strong>真诚沟通</strong>
                  <p>拒绝 PUA 套路，倡导共情与边界感</p>
                </div>
              </div>
              <div className="feature">
                <span aria-hidden="true">
                  <FeatureIcon iconKey="chart" />
                </span>
                <div>
                  <strong>约会前把安排想清楚</strong>
                  <p>资料、聊天、约会，一次聊明白</p>
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
              // P276: the version toggle follows the bubble that actually
              // carries a parked version — every row gets the handler and
              // MessageBubble only renders the control when a slot exists.
              onToggleReplyVersion={onToggleReplyVersion}
            />
          ))}

        {/* P161/P253: an interrupted stream leaves a persisted user bubble
            with no reply; offer to resend it without retyping. Hidden the
            moment any assistant row (streaming or error) trails it, and
            while the filtered search view is active. */}
        {!restoring && !searching && onGenerateReply && needsReply(messages) && (
          <div className="pending-reply-row">
            <span className="pending-reply-note">这次没等到回复</span>
            <button
              type="button"
              className="pending-reply-btn"
              onClick={onGenerateReply}
              disabled={!canGenerateReply(messages, loading)}
              aria-label="重新发送"
              title="上次没等到回复，点击重新发送这条消息"
            >
              ↻ 重新发送
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
      {/* P255: a soft, single line after the first reply — normal flow, so
          it can never cover or intercept #chat-input. Not a modal, not a
          banner; opening the dialog or pressing × dismisses it for the
          session. */}
      {profileNudgeVisible && onSetupProfile && (
        <div className="profile-nudge" role="status">
          <span className="profile-nudge-text">想让我更懂你的处境？</span>
          <button
            type="button"
            className="profile-nudge-btn"
            onClick={() => {
              setProfileNudgeDismissed(true);
              onSetupProfile();
            }}
          >
            完善资料
          </button>
          <button
            type="button"
            className="profile-nudge-dismiss"
            aria-label="先不用"
            title="先不用"
            onClick={() => setProfileNudgeDismissed(true)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
      <InputBar
        ref={inputRef}
        onSend={handleSend}
        streaming={loading}
        onStop={onStop}
        disabled={loading || restoring}
        draftKey={sessionId ?? DEFAULT_DRAFT_ID}
        rateLimit={rateLimit}
        replyLength={replyLength}
        onReplyLengthChange={onReplyLengthChange}
        queuedCount={queuedCount}
        onCancelQueue={onCancelQueue}
      />
    </div>
  );
});

export default ChatWindow;
