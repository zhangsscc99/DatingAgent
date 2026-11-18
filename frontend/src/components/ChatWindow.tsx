import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ChatMessage, ConversationMemory, UserProfile } from '../types';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import SessionSkeleton from './SessionSkeleton';
import ChatSearchBar from './ChatSearchBar';
import ErrorToast from './ErrorToast';
import UndoToast from './UndoToast';
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
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  MEMORY_RECEIPT_PREFIX,
  memoryReceiptItems,
  rememberedItems,
} from '../lib/memoryReceipt';
import {
  dismissReceiptItem,
  dismissedReceiptItems,
  restoreReceiptItem,
} from '../lib/memoryReceiptDismissals';
import { hasInteracted } from '../lib/interactionState';
import { shouldAutoScroll } from '../lib/autoScroll';
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

/** P330: how long the 已忘记 undo toast stays armed. */
const MEMORY_UNDO_MS = 6000;

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
  /**
   * P339: the server-held memory of this conversation — the keyed facts
   * mined per user turn on the backend. When provided, the capsule lists
   * exactly these facts (first 3 + 「共 N 条」) and each row can be
   * forgotten server-side; when undefined the capsule keeps deriving its
   * facts locally from the messages (the pre-P339 fallback).
   */
  memory?: ConversationMemory;
  /** P339: 忘记这条 — delete one fact by key; the row stays until the
   * backend confirms, so a failed delete is never faked away. */
  onForgetMemory?: (key: string, label: string) => void;
}

/** P206/P226: lets the header search toggle drive the in-conversation search
 * at every breakpoint — nothing floats over .messages-wrap anymore. */
export interface ChatWindowHandle {
  openSearch: () => void;
  /** P316: drop a ready-to-edit prompt into the composer — the same
   * inputRef.prefill path the welcome chips use; never auto-sends. */
  prefillComposer: (text: string) => void;
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
  memory,
  onForgetMemory,
}: Props, ref) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarHandle>(null);
  const wasRestoring = useRef(false);
  const wasLoading = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // P328: how far the scrollport sits from the tail — refreshed by the
  // scroll handler; 0 (at bottom) until the first measurement, so first
  // render and restore behave as before.
  const distanceFromBottomRef = useRef(0);
  // P328: the newest user bubble already seen — a send while scrolled up is
  // an "own turn" and always follows to the bottom.
  const lastUserMessageIdRef = useRef<string | null>(null);
  // P328: set when content arrived while the user was away from the bottom —
  // the jump button wears a 「有新内容」 pill until they return or click it.
  const [hasNewBelow, setHasNewBelow] = useState(false);
  // P328: the polite live region announces once per burst, not per delta.
  const newBelowAnnouncedRef = useRef(false);
  const [scrollLiveText, setScrollLiveText] = useState('');

  // P336: at ≤768px the three welcome feature cards collapse into one
  // quiet non-interactive summary line so the phone first screen keeps a
  // single focus — the composer send key.
  const compactFeatures = useMediaQuery('(max-width: 768px)');

  // P293/P296/P308: the memory receipt — a small icon capsule anchored at
  // the right of the session header area naming what the agent already
  // remembers (stored profile fields, the reply-length preference, and —
  // for the default profile-less path — durable facts the user stated in
  // this very conversation). Clicking it opens the remembered list, where
  // each row can be deleted; a deleted item is recorded in
  // memoryReceiptDismissals and drops out of the derivation for good.
  // Nothing renders before a conversation exists or while a session is
  // still being restored, and nothing renders when there is nothing
  // remembered.
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [dismissedFacts, setDismissedFacts] = useState<readonly string[]>(() =>
    dismissedReceiptItems(),
  );
  // P330: the single undo slot behind the 已忘记 toast — the item string of
  // the most recent deletion. A second delete retargets it, so only the
  // newest dismissal is recoverable (the older one stays forgotten).
  const [memoryUndoItem, setMemoryUndoItem] = useState<string | null>(null);
  // P339: each row is a label plus the server key when the fact comes from
  // the backend memory (null for locally-derived items — profile fields
  // and, in fallback mode, mined message facts).
  const receiptRows: Array<{ label: string; key: string | null }> =
    !restoring && messages.length > 0
      ? memory !== undefined
        ? [
            ...rememberedItems(profile, replyLength).map((label) => ({
              label,
              key: null as string | null,
            })),
            ...memory.items.map((fact) => ({
              label: fact.text,
              key: fact.key,
            })),
          ]
        : memoryReceiptItems(profile, replyLength, messages).map((label) => ({
            label,
            key: null as string | null,
          }))
      : [];
  // Local dismissals hide only locally-derived rows — a keyed server fact
  // must stay visible so it can always be forgotten properly.
  const visibleRows = receiptRows.filter(
    (row) => row.key !== null || !dismissedFacts.includes(row.label),
  );
  const memoryReceipt =
    visibleRows.length > 0
      ? `${MEMORY_RECEIPT_PREFIX}${visibleRows
          .slice(0, 3)
          .map((row) => row.label)
          .join('；')}${visibleRows.length > 3 ? ` · 共 ${visibleRows.length} 条` : ''}`
      : null;
  const handleDismissFact = (item: string) => {
    setDismissedFacts(dismissReceiptItem(item));
    setMemoryUndoItem(item);
  };
  // P339: 忘记这条 — a keyed fact is forgotten through the backend; without
  // a handler the local dismissal keeps the row deletable.
  const handleForgetFact = (key: string, label: string) => {
    if (onForgetMemory) {
      onForgetMemory(key, label);
      return;
    }
    handleDismissFact(label);
  };
  const handleUndoDismissFact = () => {
    const item = memoryUndoItem;
    setMemoryUndoItem(null);
    if (item !== null) setDismissedFacts(restoreReceiptItem(item));
  };

  // P330: the toast auto-hides after MEMORY_UNDO_MS. A new target restarts
  // the window (the item string changes → the effect re-runs), and the
  // cleanup clears the pending timer on clear/unmount so nothing sets
  // state on a dead component or leaks a timer.
  useEffect(() => {
    if (memoryUndoItem === null) return;
    const timer = setTimeout(() => setMemoryUndoItem(null), MEMORY_UNDO_MS);
    return () => clearTimeout(timer);
  }, [memoryUndoItem]);

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
    // P308: the nudge and the memory capsule are mutually exclusive — when
    // the capsule is resident the bottom 完善资料 hint stays down.
    visibleRows.length === 0 &&
    !isOnboardingComplete() &&
    messages.some(
      (m) =>
        m.role === 'assistant' &&
        !m.streaming &&
        !m.error &&
        m.content.length > 0,
    );

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

  // P299: while `restoring` is up the bubbles are not in the DOM — the
  // session skeleton stands in, so chasing the tail then lands on the
  // placeholder and the commit that swaps in the real messages never
  // re-fires the effect. A restored/switched conversation stayed pinned at
  // scrollTop 0. Arm a one-shot jump instead and fire it on the first
  // commit that renders the restored bubbles.
  const restoredJump = useRef(false);
  useEffect(() => {
    // P294: an empty conversation shows the welcome block pinned to the top —
    // the sentinel sits below it, so scrolling to it on first mount clips the
    // heading. Only chase the tail when there is something to chase.
    if (restoring) {
      restoredJump.current = true;
      return;
    }
    if (messages.length === 0 && !loading) return;
    let lastUserId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserId = messages[i].id;
        break;
      }
    }
    const isOwnTurn =
      lastUserId !== null && lastUserId !== lastUserMessageIdRef.current;
    if (lastUserId !== null) lastUserMessageIdRef.current = lastUserId;
    const jump = restoredJump.current;
    restoredJump.current = false;
    // P328: scrolled-up reading beats tail-chasing — a streaming delta or a
    // new turn must not drag the view back down. Show the jump button with
    // a once-per-burst 「有新内容」 hint instead.
    if (
      !jump &&
      !shouldAutoScroll({
        distanceFromBottom: distanceFromBottomRef.current,
        isOwnTurn,
      })
    ) {
      setShowScrollToBottom(true);
      setHasNewBelow(true);
      if (!newBelowAnnouncedRef.current) {
        newBelowAnnouncedRef.current = true;
        setScrollLiveText('有新内容');
      }
      return;
    }
    // Optimistic: we are headed to the tail, so the deltas that land before
    // the next real scroll event keep following instead of re-arming the
    // hint mid-scroll.
    distanceFromBottomRef.current = 0;
    bottomRef.current?.scrollIntoView({
      // A reload lands straight on the latest reply — jumping, not
      // smooth-scrolling, past what may be a long history.
      behavior: jump || prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [messages, loading, restoring]);

  // P24: reveal the jump button once the user scrolls well above the latest
  // message; hide it again near the bottom.
  const handleMessagesScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    distanceFromBottomRef.current = distance;
    const away = distance > SCROLL_BOTTOM_THRESHOLD;
    setShowScrollToBottom(away);
    // P328: back at the bottom — end the burst so the next excursion can
    // announce again.
    if (!away) {
      setHasNewBelow(false);
      newBelowAnnouncedRef.current = false;
      setScrollLiveText('');
    }
  };

  const scrollToLatest = () => {
    // P328: jumping by hand re-arms follow-the-tail and ends the burst.
    distanceFromBottomRef.current = 0;
    setHasNewBelow(false);
    newBelowAnnouncedRef.current = false;
    setScrollLiveText('');
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
  const prefillComposer = useCallback((text: string) => {
    inputRef.current?.prefill(text);
  }, []);
  useImperativeHandle(ref, () => ({ openSearch, prefillComposer }), [
    openSearch,
    prefillComposer,
  ]);

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

  // P343: the one condition under which the welcome hero renders — the
  // scrollport modifier hangs off the same flag so the two can never drift.
  const heroVisible = !restoring && !searchOpen && messages.length === 0;

  return (
    <div className="chat-window">
      {memoryReceipt && (
        <div className="memory-receipt" role="status">
          <div className="memory-capsule-wrap">
            <button
              type="button"
              className="memory-capsule"
              aria-label="管理记忆"
              aria-expanded={memoryOpen}
              title="来自你的资料与本对话 — 点击查看或删除"
              onClick={() => setMemoryOpen((v) => !v)}
            >
              <svg
                className="memory-capsule-icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span className="memory-capsule-text">{memoryReceipt}</span>
              <svg
                className="memory-capsule-chevron"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {memoryOpen && (
              <div className="memory-panel" role="group" aria-label="已记住的内容">
                {visibleRows.map((row) => (
                  <div className="memory-panel-row" key={row.key ?? row.label}>
                    <span className="memory-panel-text">{row.label}</span>
                    {row.key !== null ? (
                      <button
                        type="button"
                        className="memory-panel-delete memory-panel-forget"
                        aria-label={`忘记这条：${row.label}`}
                        title={`忘记这条：${row.label}`}
                        onClick={() => handleForgetFact(row.key!, row.label)}
                      >
                        忘记这条
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="memory-panel-delete"
                        aria-label={`删除记忆：${row.label}`}
                        title={`删除记忆：${row.label}`}
                        onClick={() => handleDismissFact(row.label)}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
          // P343: while the empty-state hero is up, the scrollport wears a
          // modifier that turns the bookend-centring off — the .hero box
          // fills the scrollport instead, centring its own content and
          // pinning the footer link to the block's foot (no dead band).
          className={heroVisible ? 'messages messages-hero' : 'messages'}
          role="log"
          aria-busy={restoring || loading}
          onScroll={handleMessagesScroll}
        >
        {restoring && <SessionSkeleton />}

        {!restoring && searching && matchCount === 0 && (
          <div className="search-empty">没有找到包含「{query.trim()}」的消息</div>
        )}

        {heroVisible && (
          // P337: `.hero` marks the empty-state content block — the first
          // screen's vertical-balance contract measures its top/bottom gaps.
          <div className="welcome hero animate-in">
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
            {/* P312: the composer owns the single start entry — the old
                hero button only duplicated the textarea's job, so what
                remains here is passive guidance, not a control. */}
            <p className="welcome-hint">
              在下方输入框写下你的情况，回车发送即可开始。
            </p>
            {/* P343: ≤768px demotes the three starter chips to one muted,
                non-interactive hint line — text, not button-chrome — so
                the composer's send key stays the first screen's only real
                action. The tappable chips keep working ≥769px. */}
            {compactFeatures ? (
              <p className="starter-chips-line">
                也可以直接问：{STARTER_PROMPTS.map((p) => p.label).join(' · ')}
              </p>
            ) : (
              <div className="starter-chips" role="group" aria-label="开始话题">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="starter-chip secondary"
                    aria-label={p.label}
                    onClick={() => inputRef.current?.prefill(p.prompt)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {/* P336: ≤768px renders one muted non-interactive line instead
                of the three cards — the card grid stays ≥769px. */}
            {compactFeatures ? (
              <p className="welcome-feature-line">
                帮你把话说到点上 · 真诚沟通 · 约会前把安排想清楚
              </p>
            ) : (
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
            )}
            {/* P336/P343: the「完善资料」entry sits at the foot of the
                welcome block — a footnote link, not a control in the main
                flow. At ≤768px it drops out of the button pool entirely:
                a role="link" span keeps the same entry (click + Enter) so
                the first screen's buttons stay at menu/theme/more + send;
                ≥769px keeps the real button. */}
            {!profile?.name && onSetupProfile && (
              compactFeatures ? (
                <span
                  className="welcome-cta"
                  data-variant="link"
                  role="link"
                  tabIndex={0}
                  onClick={onSetupProfile}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSetupProfile();
                    }
                  }}
                >
                  完善资料，获得更个性化建议 →
                </span>
              ) : (
                <button
                  type="button"
                  className="welcome-cta"
                  data-variant="link"
                  onClick={onSetupProfile}
                >
                  完善资料，获得更个性化建议 →
                </button>
              )
            )}
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
            className={
              hasNewBelow ? 'scroll-to-bottom has-new' : 'scroll-to-bottom'
            }
            aria-label={hasNewBelow ? '有新内容，回到底部' : '滚动到底部'}
            onClick={scrollToLatest}
          >
            ↑
            {hasNewBelow && (
              <span className="scroll-to-bottom-hint">有新内容</span>
            )}
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {scrollLiveText}
        </span>
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
        // P336: on the empty first screen the composer is the single
        // primary CTA — InputBar turns that into its spotlight treatment
        // (a light brand tint on narrow viewports).
        spotlight={!restoring && messages.length === 0}
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
      {/* P330: a deleted fact stays recoverable for a few seconds — the
          same toast surface the 清空全部 undo uses (position:fixed, so the
          spot in this tree is presentational only). */}
      {memoryUndoItem !== null && (
        <UndoToast
          text="已忘记这条记忆"
          actionLabel="撤销"
          onAction={handleUndoDismissFact}
          onDismiss={() => setMemoryUndoItem(null)}
        />
      )}
    </div>
  );
});

export default ChatWindow;
