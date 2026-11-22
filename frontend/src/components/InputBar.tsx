import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { DEFAULT_DRAFT_ID, draftStorageKey } from '../lib/chatDrafts';
import {
  COMPOSER_PLACEHOLDER_FULL,
  COMPOSER_PLACEHOLDER_NARROW,
  NARROW_COMPOSER_QUERY,
  isNarrowComposerViewport,
} from '../lib/composerPlaceholder';
import { shouldSubmitOnEnter, type KeyEventLike } from '../lib/ime';
import { loadInputHistory } from '../lib/inputHistory';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  effectiveBudget,
  rateLimitHint,
  rateLimitTickerActive,
  rateLimitWarning,
  type RateLimitBudget,
} from '../lib/rateLimitStatus';
import {
  nextReplyLengthPreference,
  replyLengthLabel,
  replyLengthToggleAriaLabel,
  type ReplyLengthPreference,
} from '../lib/replyLength';
import { queueHintText, restoreQueuedDraft } from '../lib/sendQueue';
import { CONSTRAINT_CHIPS } from '../lib/constraintChips';
import './InputBar.css';

export interface InputBarHandle {
  focus: () => void;
  /** Fill the composer with `text` and focus it (used by empty-state chips). */
  prefill: (text: string) => void;
}

interface Props {
  /** P407: `constraints` carries the picked 本轮约束 chip labels for this turn. */
  onSend: (text: string, constraints?: string[]) => void;
  disabled?: boolean;
  /** True while a reply is streaming — the send button becomes a stop button. */
  streaming?: boolean;
  /** P12: abort the in-flight generation. */
  onStop?: () => void;
  /** Per-session key so each conversation keeps its own unsent draft. */
  draftKey?: string;
  /** P07: last known chat request budget; null until the first response arrives. */
  rateLimit?: RateLimitBudget | null;
  /** P205: current reply-length preference shown on the tool-row cycler. */
  replyLength?: ReplyLengthPreference;
  /** P205: cycles the preference — the same setter the settings sheet uses. */
  onReplyLengthChange?: (next: ReplyLengthPreference) => void;
  /** P244: drafts already queued to auto-send when the current reply ends. */
  queuedCount?: number;
  /** P244: drop the queued drafts; returns their text so the composer can restore it. */
  onCancelQueue?: () => string[];
  /** P336: true on the empty first screen — on narrow viewports the bar
   *  wears a light brand tint marking it as the one place to start. */
  spotlight?: boolean;
}

/** Must match MAX_MESSAGE_CHARS in backend/src/lib/guardrails.ts (413 above it). */
const MAX_MESSAGE_CHARS = 4000;
/** Show the counter once the user is close to the cap. */
const COUNTER_THRESHOLD = 3600;
/** Persisted drafts are capped at 4 KB so localStorage stays small. */
const MAX_DRAFT_CHARS = 4096;

function loadDraft(draftKey: string): string {
  try {
    return localStorage.getItem(draftStorageKey(draftKey))?.slice(0, MAX_DRAFT_CHARS) ?? '';
  } catch {
    return '';
  }
}

/** Show ⌘ on Apple platforms, Ctrl elsewhere — purely cosmetic hint text. */
const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

/**
 * P203/P244 — one composer Enter keystroke's outcome. A real Enter (the
 * same condition `shouldSubmitOnEnter` uses — Shift+Enter and IME
 * composition untouched) is always consumed and submitted; while a reply
 * is streaming the submit lands in the pending queue (App decides), so
 * the key is never swallowed silently. Keys the textarea should keep
 * (Shift+Enter newline, IME candidate select) return untouched — no
 * preventDefault, no action.
 */
export function runComposerEnter(
  e: KeyEventLike & { preventDefault: () => void },
  submit: () => void,
): void {
  if (!shouldSubmitOnEnter(e)) return;
  e.preventDefault();
  submit();
}

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  {
    onSend,
    disabled,
    streaming = false,
    onStop,
    draftKey,
    rateLimit = null,
    replyLength = 'default',
    onReplyLengthChange,
    queuedCount = 0,
    onCancelQueue,
    spotlight = false,
  },
  ref,
) {
  const draftId = draftKey ?? DEFAULT_DRAFT_ID;
  const [text, setText] = useState(() => loadDraft(draftId));
  const draftIdRef = useRef(draftId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // P407: 本轮约束 chip selection — labels kept in CONSTRAINT_CHIPS order so
  // the injected hint reads deterministically regardless of click order.
  const [constraints, setConstraints] = useState<string[]>([]);

  // P193: the full placeholder wraps to three clipped lines inside the 50 px
  // composer at 390 px, so ≤430 px viewports get a short hint instead. The
  // aria-label keeps the full description at every width.
  const [narrowViewport, setNarrowViewport] = useState(isNarrowComposerViewport);

  // P343: the mobile empty first screen keeps one obvious action — the
  // send key. While the composer is spotlighted at ≤768px the
  // reply-length cycler drops off the tool row (visible clickables stay at
  // menu/theme/more + send); it returns with the first conversation, and
  // the settings sheet keeps the preference on phones meanwhile.
  const compactViewport = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(NARROW_COMPOSER_QUERY);
    const onChange = () => setNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    // P237: also re-check on window 'resize' — engines/webviews that don't
    // reliably deliver MediaQueryList 'change' still fire 'resize', and
    // `mq.matches` is read fresh, so the copy follows orientation flips and
    // desktop window narrowing instead of staying clipped at mount length.
    window.addEventListener('resize', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  // P06: terminal-style recall of sent messages. `historyPos` counts steps
  // back from the newest entry (null = not browsing); `browseDraft` holds
  // the text that was in the box when browsing started so it is never lost.
  const historyPosRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const browseDraftRef = useRef('');
  const [historyAnnouncement, setHistoryAnnouncement] = useState('');

  // Session switch: load that session's draft (the old one is already
  // persisted) and drop the previous conversation's recall state — ArrowUp
  // must never surface another session's messages (P168).
  useEffect(() => {
    if (draftIdRef.current === draftId) return;
    const prevDraftId = draftIdRef.current;
    draftIdRef.current = draftId;
    historyRef.current = [];
    historyPosRef.current = null;
    const incoming = loadDraft(draftId);
    // P203: 'default' → <assigned session id> fires when the backend names a
    // fresh chat at stream end — the conversation never changed, so text
    // the user drafted mid-stream survives the key swap (the persist effect
    // then re-homes it under the new id). A real session switch — where the
    // target session has its own draft — still swaps the composer contents.
    if (prevDraftId === DEFAULT_DRAFT_ID && incoming === '' && text !== '') {
      return;
    }
    setText(incoming);
  }, [draftId, text]);

  // Persist the in-progress draft; cleared on send when `text` empties.
  useEffect(() => {
    try {
      if (text) {
        localStorage.setItem(draftStorageKey(draftId), text.slice(0, MAX_DRAFT_CHARS));
      } else {
        localStorage.removeItem(draftStorageKey(draftId));
      }
    } catch {
      // Storage unavailable — drafts are best-effort only.
    }
  }, [text, draftId]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    prefill: (text: string) => {
      historyPosRef.current = null;
      setText(text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  // P421: a known budget is a snapshot that decays — tick once a second so
  // the 「约 N 秒」 count runs down and the chip disappears when its window
  // reopens. No timer at all while no budget is known (the common case).
  // P422: the heartbeat only runs while a hint could actually render — a
  // comfortable or expired budget shows nothing, so an interval there is a
  // pure wasted re-render once a second until the page closes.
  const [rateLimitNow, setRateLimitNow] = useState(() => Date.now());
  // A fresh snapshot resets the clock: a stopped ticker leaves rateLimitNow
  // stale, and a new budget must not be misread as expired or over-counted.
  useEffect(() => {
    setRateLimitNow(Date.now());
  }, [rateLimit]);
  const tickerActive = rateLimitTickerActive(rateLimit, rateLimitNow);
  useEffect(() => {
    if (!tickerActive) return;
    const id = window.setInterval(() => setRateLimitNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [
    tickerActive,
    rateLimit?.observedAt,
    rateLimit?.remaining,
    rateLimit?.retryAfterSec,
  ]);

  const toggleConstraint = (label: string) => {
    setConstraints((prev) => {
      const next = prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label];
      return CONSTRAINT_CHIPS.filter((chip) => next.includes(chip.label)).map(
        (chip) => chip.label,
      );
    });
  };

  const submit = () => {
    // P224/P244: a second turn must never *start* while one is in flight,
    // but the typed message is no longer dropped — while `streaming` the
    // submit reaches onSend and App parks it in the pending queue. Only a
    // non-streaming disable (session restore) still blocks submission.
    if (!text.trim() || (disabled && !streaming)) return;
    historyPosRef.current = null;
    // P407: the constraint snapshot travels with THIS send — a queued draft
    // keeps the chips picked at submit time; the row then resets so the
    // next turn starts unconstrained.
    const picked = constraints.length > 0 ? constraints : undefined;
    onSend(text, picked);
    setText('');
    setConstraints([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  /** P244: 「取消排队」 — App drops the pending queue; its text comes back
   * here and rejoins the box ahead of anything typed since. */
  const cancelQueue = () => {
    const restored = onCancelQueue?.() ?? [];
    if (restored.length === 0) return;
    historyPosRef.current = null;
    setText((prev) => restoreQueuedDraft(restored, prev));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const announceRecall = (pos: number, total: number) => {
    setHistoryAnnouncement(`已恢复历史消息 ${pos + 1}/${total}`);
  };

  /** ArrowUp: step one entry older (history is stored newest-last). */
  const stepBackHistory = () => {
    if (historyPosRef.current === null) {
      historyRef.current = loadInputHistory(draftId);
      if (historyRef.current.length === 0) return;
      browseDraftRef.current = textareaRef.current?.value ?? text;
      historyPosRef.current = 0;
    } else if (historyPosRef.current < historyRef.current.length - 1) {
      historyPosRef.current += 1;
    }
    const entry = historyRef.current[historyRef.current.length - 1 - historyPosRef.current];
    setText(entry);
    announceRecall(historyPosRef.current, historyRef.current.length);
  };

  /** ArrowDown: step one entry newer; past the newest restores the draft. */
  const stepForwardHistory = () => {
    if (historyPosRef.current === null) return;
    if (historyPosRef.current > 0) {
      historyPosRef.current -= 1;
      const entry = historyRef.current[historyRef.current.length - 1 - historyPosRef.current];
      setText(entry);
      announceRecall(historyPosRef.current, historyRef.current.length);
    } else {
      historyPosRef.current = null;
      setText(browseDraftRef.current);
      setHistoryAnnouncement('已恢复草稿');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc: while browsing history, leave history mode and hand the saved
    // draft back; otherwise drop focus out of the composer (mobile keyboard
    // dismissal, Tab-out on desktop).
    if (e.key === 'Escape') {
      e.preventDefault();
      if (historyPosRef.current !== null) {
        historyPosRef.current = null;
        setText(browseDraftRef.current);
        setHistoryAnnouncement('已恢复草稿');
        return;
      }
      textareaRef.current?.blur();
      return;
    }

    // P06: ↑/↓ recall sent messages like a terminal — only when it cannot
    // fight normal editing (empty box, caret at offset 0, or already
    // browsing) and never with a modifier held.
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const el = textareaRef.current;
      if (e.key === 'ArrowDown') {
        if (historyPosRef.current === null) return;
        e.preventDefault();
        stepForwardHistory();
        return;
      }
      const caretAtStart =
        el !== null && el.selectionStart === 0 && el.selectionEnd === 0;
      if (historyPosRef.current !== null || el?.value === '' || caretAtStart) {
        e.preventDefault();
        stepBackHistory();
      }
      return;
    }

    // P167: only a real Enter is handled. Shift+Enter keeps the default
    // newline behaviour, and a composing Enter is left for the IME — no
    // preventDefault, no action (all inside runComposerEnter).
    // P244: while a reply streams, the same keystroke queues the draft for
    // auto-send instead of silently dropping it.
    runComposerEnter(e, submit);
  };

  // P203: keep the composer editable while a reply streams — the next
  // message can be drafted and queued while the current one generates.
  // P224: the send button never leaves the DOM; during streaming it stays
  // enabled and queues the draft (P244), while 停止 remains a separate
  // explicit stop. Only a non-streaming disable (restoring) blocks it.
  const sendBlocked = Boolean(disabled) && !streaming;
  const composerDisabled = sendBlocked;
  const showCounter = text.length >= COUNTER_THRESHOLD;
  // P07/P256: the budget readout only speaks once the minute is nearly
  // spent — a comfortable budget (or an unknown one) renders nothing at
  // all, so no element is left carrying the count for a screen reader.
  // P421: the stored snapshot is routed through effectiveBudget first, so
  // once its window has reopened the chip is gone, not fossilized.
  const liveBudget =
    rateLimit !== null ? effectiveBudget(rateLimit, rateLimitNow) : null;
  const rateHint = liveBudget !== null ? rateLimitHint(liveBudget, rateLimitNow) : null;
  const rateWarn = liveBudget !== null && rateLimitWarning(liveBudget);
  // P07: the rate-limit readout sits beside the counter inside the field, so
  // reserve the same bottom padding whenever either is visible.
  const showRateLimit = rateHint !== null;
  const fieldClass =
    showCounter || showRateLimit ? 'input-field has-counter' : 'input-field';

  return (
    <div
      className="input-bar"
      role="form"
      aria-label="发送消息"
      data-spotlight={spotlight && narrowViewport ? 'true' : undefined}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {historyAnnouncement}
      </span>
      <label htmlFor="chat-input" className="sr-only">
        输入你的问题
      </label>
      {/* P305: the composer's working content lives inside .input-column —
          the same centred --column-max the message list uses — while
          .input-bar keeps its full-width surface and border-top. */}
      <div className="input-column">
      <div className={fieldClass}>
        <textarea
          ref={textareaRef}
          id="chat-input"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          enterKeyHint="send"
          value={text}
          onChange={(e) => {
            // P06: typing or pasting leaves history-browse mode.
            historyPosRef.current = null;
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            narrowViewport ? COMPOSER_PLACEHOLDER_NARROW : COMPOSER_PLACEHOLDER_FULL
          }
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          disabled={composerDisabled}
          aria-label={COMPOSER_PLACEHOLDER_FULL}
          aria-disabled={composerDisabled}
          aria-describedby={showCounter ? 'chat-input-counter' : undefined}
          title={`Enter 发送 · Shift+Enter 换行 · ${MOD_KEY}+Enter 发送 · ↑ 历史消息 · Esc 收起输入`}
        />
        {rateHint !== null && (
          <span
            className={
              rateWarn ? 'rate-limit-indicator warn' : 'rate-limit-indicator'
            }
            title="每分钟重置"
            aria-label={`${rateHint}，每分钟重置`}
          >
            {rateHint}
          </span>
        )}
        {showCounter && (
          <span
            id="chat-input-counter"
            className={
              text.length >= MAX_MESSAGE_CHARS ? 'input-counter at-limit' : 'input-counter'
            }
            aria-live="polite"
          >
            {text.length}/{MAX_MESSAGE_CHARS}
          </span>
        )}
      </div>
      {/* P407: 本轮约束 capsules — a quiet multi-select row above the tool
          row. Picked labels ride the request as a 「本轮约束：…」 hint and
          the turn's assistant bubble echoes them back as 「已按约束：…」.
          Unselected state sends byte-identical bodies to today. Like the
          length cycler it drops off the spotlighted phone empty screen —
          the first screen keeps its one obvious action (P343). */}
      {!(spotlight && compactViewport) && (
        <div className="constraint-chips" role="group" aria-label="本轮约束">
          {CONSTRAINT_CHIPS.map((chip) => {
            const pressed = constraints.includes(chip.label);
            return (
              <button
                key={chip.id}
                type="button"
                className="constraint-chip"
                aria-pressed={pressed}
                onClick={() => toggleConstraint(chip.label)}
                title={`本轮约束：${chip.label}`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
      {/* P205: the composer tool row — length cycler, shortcut hint and
          send/stop stay in one group so they wrap (or not) as a unit on
          narrow viewports instead of stranding the send button alone. */}
      <div className="input-tools">
        {/* In-place reply-length cycler — writes the same storage key the
            settings sheet uses; 默认 keeps the request body byte-identical
            to before (no hint injected). */}
        {onReplyLengthChange && !(spotlight && compactViewport) && (
          /* P385: the pill reads as a flat label chip — it is really an
             option picker, so it carries the dropdown affordance on both
             layouts: a chevron child plus the listbox popup semantics. */
          <button
            type="button"
            className="reply-length-toggle"
            data-length={replyLength}
            onClick={() => onReplyLengthChange(nextReplyLengthPreference(replyLength))}
            aria-label={replyLengthToggleAriaLabel(replyLength)}
            aria-haspopup="listbox"
            aria-expanded={false}
            title={replyLengthToggleAriaLabel(replyLength)}
          >
            {replyLengthLabel(replyLength)}
            <svg
              className="reply-length-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
        {/* P336: the shortcut-hint button documents physical-keyboard
            keys — meaningless chrome on a ≤430px phone where it also
            competed with the send key as a second composer control. */}
        {!narrowViewport && (
          <div className="input-hint">
            <button
              type="button"
              className="input-hint-btn"
              aria-label="键盘快捷键说明"
              aria-describedby="input-kbd-tip"
              tabIndex={0}
            >
              <svg
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
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="M6 8h.01" />
                <path d="M10 8h.01" />
                <path d="M14 8h.01" />
                <path d="M18 8h.01" />
                <path d="M6 12h.01" />
                <path d="M10 12h.01" />
                <path d="M14 12h.01" />
                <path d="M18 12h.01" />
                <path d="M7 16h10" />
              </svg>
            </button>
            <div id="input-kbd-tip" className="input-hint-tip" role="tooltip">
              <span>
                <kbd>Enter</kbd> 或 <kbd>{MOD_KEY}+Enter</kbd> 发送
              </span>
              <span>
                <kbd>Shift+Enter</kbd> 换行
              </span>
              <span>
                <kbd>↑</kbd>/<kbd>↓</kbd> 历史消息
              </span>
              <span>
                <kbd>Esc</kbd> 收起输入框
              </span>
            </div>
          </div>
        )}
        {/* P224: the send button never leaves the DOM — during streaming it
            renders first in DOM order (so `.input-send` queries hit the
            queueing send) and the stop button sits beside it. A second
            send attempt is therefore blocked at the control, at submit(),
            and again at App's sendMessage — never reaching streamReply. */}
        {/* P312: the composer's send key is the first screen's single
            primary action — the welcome block carries no button at all. */}
        {/* P326: while a reply streams the bottom-right keeps exactly ONE
            primary — the accent-outlined 停止生成 next to it. The send key
            stays in the DOM and keeps queueing drafts (P244) but drops to
            the muted secondary register (data-variant="secondary", no
            marker) and names its pending semantics — 「排队」 — so pressing
            it can never be mistaken for interrupting the stream. The
            data-primary-cta marker follows the primary: send while idle,
            stop while streaming. */}
        <button
          type="button"
          className="input-send"
          data-primary-cta={streaming ? undefined : true}
          data-variant={streaming ? 'secondary' : undefined}
          onClick={submit}
          disabled={sendBlocked || !text.trim()}
          aria-label={streaming ? '排队发送：本条回复结束后发送' : '发送消息'}
          title={streaming ? '回复仍在生成，点按会把这条消息加入排队' : undefined}
        >
          <svg
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
        {streaming && onStop && (
          <button
            type="button"
            className="input-send input-stop"
            data-primary-cta
            onClick={onStop}
            aria-label="停止生成"
            title="停止生成回复"
          >
            停止
          </button>
        )}
      </div>
      {/* P203/P244/P310: fixed-height row under the composer — empty while
          idle AND while streaming with nothing queued, so the hint never
          shifts the textarea, send button, or message list. Progress copy
          belongs to the pending AI bubble; this row only speaks once
          drafts are actually parked, acknowledging them by count.
          「取消排队」 hands them back. */}
      <div className="busy-enter-hint" role="status" aria-live="polite">
        {streaming && queuedCount > 0 && queueHintText(queuedCount)}
        {streaming && queuedCount > 0 && onCancelQueue && (
          <button
            type="button"
            className="queue-cancel-btn"
            onClick={cancelQueue}
            aria-label="取消排队，文字放回输入框"
          >
            取消排队
          </button>
        )}
      </div>
      </div>
    </div>
  );
});

export default InputBar;
