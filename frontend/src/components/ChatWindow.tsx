import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ChatIntent, ChatMessage, ConversationMemory, UserProfile } from '../types';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import SessionSkeleton from './SessionSkeleton';
import ChatSearchBar from './ChatSearchBar';
import ErrorToast from './ErrorToast';
import StarterIntake from './StarterIntake';
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
import {
  dismissProfileNudge,
  isProfileNudgeDismissed,
  shouldShowProfileNudge,
} from '../lib/profileNudge';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { HERO_EXAMPLE_PROMPTS, HERO_PRIMARY_LABEL } from '../lib/heroCta';
import {
  MEMORY_RECEIPT_MAX_ITEMS,
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
import {
  firstVisibleAnchor,
  restoreAnchorFor,
  saveScrollAnchor,
} from '../lib/scrollAnchor';
import { STARTER_ENTRIES } from '../lib/starterEntries';
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

/** P352: the scroll-margin-top on .bubble-row (ChatWindow.css) — a restored
 * anchor lands this far under the scrollport's top edge; a clamped anchor
 * sits measurably lower and needs the P360 edge snap. */
const SCROLL_ANCHOR_MARGIN = 8;

/** P330: how long the 已忘记 undo toast stays armed. */
const MEMORY_UNDO_MS = 6000;

// P345: the F20 starter capsules no longer prefill a canned sentence —
// that made them dead options (a prefilled prompt is identical to typing
// it). Each chip now opens its own intake (the intent-carrying rows of
// STARTER_ENTRIES) which collects the branch's real inputs and assembles
// the first message.
// P355: the chip list is the shared STARTER_ENTRIES — the same four
// entries the sidebar「快捷入口」renders, same order, same labels. An
// entry with no intake branch still does real work: its prompt prefills
// the composer (the P316 drawer path), it is never a dead option.

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  /** P192: elapsed-time placeholder text while the reply's first token is in flight. */
  waitingLabel?: string;
  restoring?: boolean;
  profile?: UserProfile | null;
  sessionId?: string | null;
  /** P345: `intent` rides along when the text came from a starter intake. */
  onSend: (text: string, intent?: ChatIntent) => void;
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
   * exactly these facts (P351: 记得 N 件事 lead + first-3 pills + 「+N」)
   * and each row can be forgotten server-side; when undefined the capsule
   * keeps deriving its facts locally from the messages (the pre-P339
   * fallback).
   */
  memory?: ConversationMemory;
  /** P339: 忘记这条 — delete one fact by key; the row stays until the
   * backend confirms, so a failed delete is never faked away. */
  onForgetMemory?: (key: string, label: string) => void;
  /**
   * P366: the title the sidebar shows for this conversation. A memory
   * fact identical to it repeats what the title already says, so it is
   * filtered out of the capsule's pill rows and the 记得 N 件事 lead —
   * the 管理记忆 panel still lists (and can forget) it. When the prop is
   * absent the capsule keeps every row.
   */
  sessionTitle?: string | null;
}

/** P206/P226: lets the header search toggle drive the in-conversation search
 * at every breakpoint — nothing floats over .messages-wrap anymore. */
export interface ChatWindowHandle {
  openSearch: () => void;
  /** P316: drop a ready-to-edit prompt into the composer — the same
   * inputRef.prefill path the welcome chips use; never auto-sends. */
  prefillComposer: (text: string) => void;
  /** P394: open the starter intake for `intent` inside the empty-state
   * hero — the desktop replacement for the removed starter chips. Returns
   * false when the hero isn't up (mid-conversation, restoring, search
   * open) or the layout is compact, so the caller can fall back to the
   * plain composer prefill. */
  openStarterIntent: (intent: ChatIntent) => boolean;
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
  sessionTitle = null,
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

  // P345: which starter intake is open in the hero (null = none), and the
  // intent armed by the last intake fill — attached to the very next send,
  // then cleared. A typed message that never touched a starter sends no
  // intent. P394: the hero's own starter capsules are gone (the sidebar's
  // 快捷入口 owns the four names on desktop now), so the intake opens via
  // the openStarterIntent handle instead of a chip toggle.
  const [activeStarter, setActiveStarter] = useState<ChatIntent | null>(null);
  const [pendingIntent, setPendingIntent] = useState<ChatIntent | null>(null);

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
  // P351: the receipt used to join every fact with ； on a single nowrap
  // line — the overflow was ellipsised and the trailing 「共 N 条」 count
  // was eaten with it. The capsule now leads with an always-visible
  // 记得 N 件事 count (first in the flow, so it can never be clipped) and
  // renders each fact as its own pill — the first three, then a 「+N」
  // chip for the rest, which the existing 管理记忆 panel lists in full.
  // P366: a fact identical to the session title duplicates what the
  // title already shows, so it drops out of the pill rows and the lead
  // count — but stays in visibleRows so the panel can still manage it.
  // P376: sessions written before the same-event merge can still hold
  // two keys with one display text — the capsule never renders the same
  // pill twice (the panel keeps every row for management).
  // P382: dedupe on the text that carries the information — the title
  // keeps the ？/。 a stored fact drops, and either side can wear a
  // trailing ellipsis the other lacks, so byte-compare misses the echo.
  // P400: the dedupe key strips punctuation, whitespace and tail
  // particles (了/的/啊/吧), and containment counts — the capsule never
  // repeats the session title nor shows two pills whose normalised text
  // is a substring of one another (the longer wording wins, first-
  // stated on a tie, matching the backend read-path dedupe).
  const capsuleKeyOf = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
      .replace(/[了的啊吧]+$/u, '');
  const capsuleTitle = capsuleKeyOf(sessionTitle ?? '');
  const capsuleEligible = visibleRows.filter((row) => {
    // P387: a fact text that still carries a question mark is the user's
    // question restated — it never renders as a pill.
    // P392: same for deliberation/question markers on pre-gate shards —
    // 「我明天直接当面质问她行不行」 stored before P387 carries no ？
    // yet is still the user's own question.
    if (
      /[?？吗呢]|行不行|要不要|该不该|是不是|能不能|可不可以|怎么|哪儿|哪里|什么/.test(
        row.label,
      )
    ) {
      return false;
    }
    const label = capsuleKeyOf(row.label);
    if (label.length === 0) return false;
    if (capsuleTitle.length === 0) return true;
    return !capsuleTitle.includes(label);
  });
  const capsuleRows = capsuleEligible.filter((row, i) => {
    const key = capsuleKeyOf(row.label);
    return !capsuleEligible.some((other, j) => {
      if (j === i) return false;
      const otherKey = capsuleKeyOf(other.label);
      if (otherKey === key) return j < i;
      return key.length >= 4 && otherKey.includes(key);
    });
  });
  const capsuleFacts = capsuleRows.slice(0, MEMORY_RECEIPT_MAX_ITEMS);
  const hiddenFactCount = capsuleRows.length - capsuleFacts.length;
  // P387: with the server-held memory loaded and every candidate filtered
  // out (questions are never facts), the capsule admits it holds nothing
  // instead of rendering a degenerate/partial list. The pre-P339 local
  // derivation (memory === undefined) keeps its quiet no-receipt behaviour.
  const showEmptyMemory =
    memory !== undefined &&
    !restoring &&
    messages.some((m) => m.role === 'user') &&
    capsuleRows.length === 0;
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
  // P255/P349: the profile suggestion above the composer is one compact
  // capsule (<=32px) offered after the first answer — never a card, never a
  // second row. A dismissal is persisted (P349) so it does not come back on
  // reload; users with a saved profile or a finished onboarding never see it.
  const [profileNudgeDismissed, setProfileNudgeDismissedState] = useState(
    () => isProfileNudgeDismissed(),
  );
  const setProfileNudgeDismissed = useCallback((value: boolean) => {
    setProfileNudgeDismissedState(value);
    if (value) dismissProfileNudge();
  }, []);
  const profileNudgeVisible = shouldShowProfileNudge({
    restoring,
    hasName: Boolean(profile?.name),
    dismissed: profileNudgeDismissed,
    rowsVisible: visibleRows.length,
    onboardingDone: isOnboardingComplete(),
    hasAnswer: messages.some(
      (m) =>
        m.role === 'assistant' &&
        !m.streaming &&
        !m.error &&
        m.content.length > 0,
    ),
  });

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

  // P352: shared by the scroll handler and the restore path — refresh the
  // tail-distance guard + jump button from the real scrollport numbers,
  // and persist the first fully visible message id as this session's
  // reload anchor so a later restore reopens where the reader left off.
  const syncScrollState = (el: HTMLDivElement) => {
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
    if (!sessionId) return;
    const rect = el.getBoundingClientRect();
    // P360: the anchor is the first VISIBLE row — including one crossing
    // the top edge. Its content offset always precedes the scroll offset
    // it was seen at, so the restore can always land it at the top edge
    // and the reopened viewport never starts on a half-cut bubble.
    const anchor = firstVisibleAnchor(
      Array.from(el.querySelectorAll('[data-message-id]'))
        .map((row) => {
          const r = row.getBoundingClientRect();
          return {
            id: row.getAttribute('data-message-id') ?? '',
            top: r.top,
            bottom: r.bottom,
          };
        })
        .filter((c) => c.id !== ''),
      rect.top,
      rect.bottom,
    );
    if (anchor !== null) saveScrollAnchor(sessionId, anchor);
  };

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
    // P352: a reload/session-switch restore re-opens where the reader left
    // off — the persisted first-fully-visible bubble aligned under the
    // scrollport's top edge (scroll-margin-top keeps it clear of the
    // memory-receipt strip), or the head of the conversation when no
    // anchor exists. Never the tail: landing mid-reply cut the first
    // visible bubble in half.
    if (jump) {
      const el = listRef.current;
      // P360: the anchor must still name a rendered message — a stale,
      // corrupted or foreign id restores to the head like no anchor at
      // all (restoreAnchorFor returns null for every dead-end case).
      const anchorId =
        sessionId && el !== null
          ? restoreAnchorFor(
              sessionId,
              Array.from(el.querySelectorAll('[data-message-id]'))
                .map((row) => row.getAttribute('data-message-id') ?? '')
                .filter((id) => id !== ''),
            )
          : null;
      const anchorRow =
        anchorId !== null && el !== null
          ? el.querySelector(`[data-message-id="${CSS.escape(anchorId)}"]`)
          : null;
      if (anchorRow) {
        anchorRow.scrollIntoView({ block: 'start', behavior: 'auto' });
        // P360: a first-visible anchor can always reach the top edge, but
        // an anchor recorded before the viewport grew (taller port, less
        // room below the row) may still clamp short of it — snap the row
        // crossing the top edge fully into view instead of leaving its
        // tail half-read.
        const port = el!.getBoundingClientRect();
        const anchored = anchorRow.getBoundingClientRect();
        if (anchored.top > port.top + SCROLL_ANCHOR_MARGIN + 1) {
          const crossing = Array.from(el!.querySelectorAll('[data-message-id]'))
            .map((row) => ({ row, rect: row.getBoundingClientRect() }))
            .find(
              ({ rect }) => rect.top < port.top && rect.bottom > port.top,
            );
          crossing?.row.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      } else if (el) {
        el.scrollTop = 0;
      }
      // The jump above only fired programmatic scrolls — resync the guard
      // and re-record the anchor so a new message can't drag the reader
      // back down and the button state is honest.
      if (el) syncScrollState(el);
      return;
    }
    // P328: scrolled-up reading beats tail-chasing — a streaming delta or a
    // new turn must not drag the view back down. Show the jump button with
    // a once-per-burst 「有新内容」 hint instead.
    if (
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
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [messages, loading, restoring]);

  // P24: reveal the jump button once the user scrolls well above the latest
  // message; hide it again near the bottom.
  const handleMessagesScroll = () => {
    const el = listRef.current;
    if (!el) return;
    syncScrollState(el);
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
  // P394: the sidebar's 快捷入口 rows drive the starter intake now — the
  // hero's own capsules are gone from the desktop empty state. Only the
  // desktop hero can host the panel, so anything else reports failure and
  // the caller falls back to a plain composer prefill (the mobile drawer
  // path keeps prefilling, as it always has).
  const openStarterIntent = useCallback(
    (intent: ChatIntent): boolean => {
      if (restoring || searchOpen || messages.length > 0 || compactFeatures) {
        return false;
      }
      setActiveStarter(intent);
      return true;
    },
    [restoring, searchOpen, messages.length, compactFeatures],
  );
  useImperativeHandle(
    ref,
    () => ({ openSearch, prefillComposer, openStarterIntent }),
    [openSearch, prefillComposer, openStarterIntent],
  );

  // P375: publish the composer's live height as --composer-h so .messages
  // can hold a scroll-end inset of composer+16px — the tail bubble then
  // stops clear of the bar (the bar grows with the textarea, so a fixed
  // value would drift; the CSS fallback covers the unmeasured case).
  useEffect(() => {
    const win = listRef.current?.closest(
      '.chat-window',
    ) as HTMLElement | null;
    const bar = win?.querySelector('.input-bar') as HTMLElement | null;
    if (!win || !bar) return;
    const apply = () => {
      const h = bar.getBoundingClientRect().height;
      if (h > 0) win.style.setProperty('--composer-h', `${Math.round(h)}px`);
    };
    apply();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const nextMatch = () => {
    if (matchCount > 0) setActiveIndex((i) => (i + 1) % matchCount);
  };

  const prevMatch = () => {
    if (matchCount > 0) setActiveIndex((i) => (i - 1 + matchCount) % matchCount);
  };

  // P162: sending while the search bar is open would hide the new message
  // behind the stale filter — close search first so it appears immediately.
  // P345: a starter-assembled draft carries its branch's intent with it.
  const handleSend = (text: string) => {
    if (searchOpen) closeSearch();
    onSend(text, pendingIntent ?? undefined);
    setPendingIntent(null);
  };

  // P345: the intake hands its assembled message to the composer (the same
  // prefill path the sidebar entries use — the user still presses send)
  // and arms the intent that rides on the request body.
  const handleStarterFill = (text: string) => {
    if (activeStarter !== null) setPendingIntent(activeStarter);
    setActiveStarter(null);
    inputRef.current?.prefill(text);
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
  // P394: the intake lives inside the hero — if the hero drops out (a send
  // lands, a session restores, search opens) any armed panel goes with it
  // instead of popping back armed on the next empty state.
  useEffect(() => {
    if (!heroVisible) setActiveStarter(null);
  }, [heroVisible]);

  return (
    <div className="chat-window">
      {(capsuleRows.length > 0 || showEmptyMemory) && (
        <div className="memory-receipt" role="status">
          {showEmptyMemory ? (
            <span className="memory-empty">暂无可记住的信息</span>
          ) : (
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
              <span className="memory-capsule-text">
                <span className="memory-capsule-lead">
                  {`记得 ${capsuleRows.length} 件事`}
                </span>
                {capsuleFacts.map((row) => (
                  <span
                    key={row.key ?? row.label}
                    className="memory-capsule-fact"
                    data-fact="true"
                  >
                    {row.label}
                  </span>
                ))}
                {hiddenFactCount > 0 && (
                  <span className="memory-capsule-more">
                    +{hiddenFactCount}
                  </span>
                )}
              </span>
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
          )}
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
            {/* P394: the 「在下方输入框…」 guidance line is gone for good —
                it pointed off-screen while mid-hero, and even pinned above
                the composer it stayed a redundant second signpost on a
                first screen that converges on ONE input path. */}
            {/* P374: the compact first screen gets ONE obvious action — a
                real primary button that focuses #chat-input and sends
                nothing. The three example prompts stay on as a secondary,
                lighter group that still sends on tap through handleSend
                (the composer's own path): never a prefill, never a dead
                option.
                P380: the same single button now leads the desktop empty
                state too — one shared element, no second implementation;
                the example group stays compact-only (the starter chips
                already cover desktop quick-starts), and the send key
                keeps the single [data-primary-cta]. */}
            <div className="hero-cta">
              <button
                type="button"
                className="hero-cta-primary"
                data-testid="hero-primary-cta"
                aria-label={HERO_PRIMARY_LABEL}
                disabled={loading}
                onClick={() => inputRef.current?.focus()}
              >
                {HERO_PRIMARY_LABEL}
              </button>
              {compactFeatures && (
                <div
                  className="hero-examples"
                  role="group"
                  aria-label="示例问题：点一条直接发送"
                >
                  {HERO_EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="hero-cta-card"
                      aria-label={`直接发送：${prompt}`}
                      disabled={loading}
                      onClick={() => handleSend(prompt)}
                    >
                      <span className="hero-cta-card-text">{prompt}</span>
                      <svg
                        className="hero-cta-card-icon"
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
                        <path d="m22 2-7 20-4-9-9-4Z" />
                        <path d="M22 2 11 13" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* P343/P374: at ≤768px the four starters render as one muted,
                non-interactive line of wrap-safe pills — the sidebar
                drawer's 快捷入口 rows are the phone's tappable path.
                P394: the desktop capsules are gone entirely — the same
                four names lived TWICE on the first screen (aside rows +
                this row), so the aside's 快捷入口 is now the single copy
                at ≥769px too. */}
            {compactFeatures && (
              <p className="starter-chips-line">
                <span className="starter-chips-lead">也可以直接问：</span>
                {STARTER_ENTRIES.map((s) => (
                  <span key={s.label} className="starter-pill">
                    {s.label}
                  </span>
                ))}
              </p>
            )}
            {/* P345/P394: the branch's intake sits in the hero — each
                starter asks for its own inputs and assembles a first
                message that prefills the composer with its intent armed.
                The desktop trigger is the sidebar's 快捷入口 row (routed
                through openStarterIntent); a non-intent entry prefills
                straight away and never reaches here. */}
            {!compactFeatures && activeStarter !== null && (
              <StarterIntake
                key={activeStarter}
                intent={activeStarter}
                onSubmit={handleStarterFill}
                onCancel={() => setActiveStarter(null)}
              />
            )}
            {/* P380: the three explanation cards are gone — they were the
                passive half of the first screen's 7 competing entries,
                and their copy overlaps the subtitle. What remains: one
                primary button. P394: the starter capsules left with them —
                the sidebar's 快捷入口 owns the four names now. */}
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
        <span className="sr-only" role="status" aria-live="polite">
          {scrollLiveText}
        </span>
      </div>

      {/* P375: the jump control moved out of .messages-wrap — floating at
          the port's bottom-right put it on top of user bubbles (they pack
          to the right edge). As a normal-flow strip it owns a slot between
          the scrollport and the composer and can never overlap a bubble. */}
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

      {offline && (
        <p className="offline-note" role="status">
          网络已断开，恢复后会自动重连
        </p>
      )}
      {/* P255: a soft, single line after the first reply — normal flow, so
          it can never cover or intercept #chat-input. Not a modal, not a
          banner; opening the dialog or pressing × dismisses it for the
          session. */}
      {/* P349: one capsule, capped at 32px, instead of the card that used to
          compete with the send key. Shown once after the first answer; the
          × (or opening the dialog) remembers the dismissal across reloads. */}
      {profileNudgeVisible && onSetupProfile && (
        <div className="profile-nudge" role="status" data-nudge="capsule">
          <button
            type="button"
            className="profile-nudge-btn"
            onClick={() => {
              setProfileNudgeDismissed(true);
              onSetupProfile();
            }}
          >
            想让我更懂你的处境？完善资料 →
          </button>
          <button
            type="button"
            className="profile-nudge-dismiss"
            aria-label="不再提示"
            title="不再提示"
            onClick={() => setProfileNudgeDismissed(true)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
      {/* P394: the 「在下方输入框…」 guidance line is gone — it named a
          target off-screen for most of the empty state's life, and with
          the hero pulled within 120px of the composer the input path
          needs no signpost. */}
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
