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
import {
  formatRateLimit,
  rateLimitDim,
  rateLimitWarning,
  type RateLimitBudget,
} from '../lib/rateLimitStatus';
import './InputBar.css';

export interface InputBarHandle {
  focus: () => void;
  /** Fill the composer with `text` and focus it (used by empty-state chips). */
  prefill: (text: string) => void;
}

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** True while a reply is streaming — the send button becomes a stop button. */
  streaming?: boolean;
  /** P12: abort the in-flight generation. */
  onStop?: () => void;
  /** Per-session key so each conversation keeps its own unsent draft. */
  draftKey?: string;
  /** P07: last known chat request budget; null until the first response arrives. */
  rateLimit?: RateLimitBudget | null;
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

/** P203: hint shown briefly when Enter is pressed while a reply streams. */
export const BUSY_ENTER_HINT_TEXT = '回复生成中，完成后可发送';
export const BUSY_ENTER_HINT_MS = 2000;

export interface BusyEnterHint {
  /** Show the hint and (re)start the auto-hide timer. */
  flash: () => void;
  /** Hide now and cancel the timer (streaming end, unmount). */
  clear: () => void;
  /** Current visibility — for tests. */
  visible: () => boolean;
}

/**
 * P203 — visibility + auto-hide timer for the Enter-while-busy hint.
 * React-free so the timing contract is testable in the node env.
 */
export function createBusyEnterHint(
  onChange: (visible: boolean) => void,
  timeoutMs = BUSY_ENTER_HINT_MS,
): BusyEnterHint {
  let isVisible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const set = (next: boolean) => {
    if (isVisible === next) return;
    isVisible = next;
    onChange(next);
  };
  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  return {
    flash() {
      cancel();
      set(true);
      timer = setTimeout(() => {
        timer = null;
        set(false);
      }, timeoutMs);
    },
    clear() {
      cancel();
      set(false);
    },
    visible: () => isVisible,
  };
}

/**
 * P203 — one composer Enter keystroke's outcome. A real Enter (the same
 * condition `shouldSubmitOnEnter` uses — Shift+Enter and IME composition
 * untouched) is always consumed; while a reply is streaming it flashes the
 * busy hint instead of submitting, so the key is no longer swallowed
 * silently. Keys the textarea should keep (Shift+Enter newline, IME
 * candidate select) return untouched — no preventDefault, no action.
 */
export function runComposerEnter(
  e: KeyEventLike & { preventDefault: () => void },
  streaming: boolean,
  actions: { submit: () => void; flashBusyHint: () => void },
): void {
  if (!shouldSubmitOnEnter(e)) return;
  e.preventDefault();
  if (streaming) {
    actions.flashBusyHint();
  } else {
    actions.submit();
  }
}

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, streaming = false, onStop, draftKey, rateLimit = null },
  ref,
) {
  const draftId = draftKey ?? DEFAULT_DRAFT_ID;
  const [text, setText] = useState(() => loadDraft(draftId));
  const draftIdRef = useRef(draftId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // P193: the full placeholder wraps to three clipped lines inside the 50 px
  // composer at 390 px, so ≤430 px viewports get a short hint instead. The
  // aria-label keeps the full description at every width.
  const [narrowViewport, setNarrowViewport] = useState(isNarrowComposerViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(NARROW_COMPOSER_QUERY);
    const onChange = () => setNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // P06: terminal-style recall of sent messages. `historyPos` counts steps
  // back from the newest entry (null = not browsing); `browseDraft` holds
  // the text that was in the box when browsing started so it is never lost.
  const historyPosRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const browseDraftRef = useRef('');
  const [historyAnnouncement, setHistoryAnnouncement] = useState('');

  // P203: while streaming the composer stays editable so the next message
  // can be drafted; Enter only flashes this hint instead of sending.
  const [busyHintVisible, setBusyHintVisible] = useState(false);
  const busyHintRef = useRef<ReturnType<typeof createBusyEnterHint> | null>(null);
  busyHintRef.current ??= createBusyEnterHint(setBusyHintVisible);
  const busyHint = busyHintRef.current;

  // Cancel the pending auto-hide on unmount, and drop the hint as soon as
  // the stream ends — a finished reply makes the notice stale.
  useEffect(() => () => busyHint.clear(), [busyHint]);
  useEffect(() => {
    if (!streaming) busyHint.clear();
  }, [streaming, busyHint]);

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

  const submit = () => {
    if (!text.trim() || disabled) return;
    historyPosRef.current = null;
    onSend(text);
    setText('');
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
    // P203: while a reply streams, the same keystroke flashes the busy
    // hint instead of silently dropping the send.
    runComposerEnter(e, streaming, {
      submit,
      flashBusyHint: busyHint.flash,
    });
  };

  // P203: keep the composer editable while a reply streams — the send path
  // is already replaced by the stop button, and Enter shows the busy hint.
  const composerDisabled = Boolean(disabled) && !streaming;
  const showCounter = text.length >= COUNTER_THRESHOLD;
  // P07: the rate-limit readout sits beside the counter inside the field, so
  // reserve the same bottom padding whenever either is visible.
  const showRateLimit = rateLimit !== null;
  const fieldClass =
    showCounter || showRateLimit ? 'input-field has-counter' : 'input-field';

  return (
    <div className="input-bar" role="form" aria-label="发送消息">
      <span className="sr-only" role="status" aria-live="polite">
        {historyAnnouncement}
      </span>
      <label htmlFor="chat-input" className="sr-only">
        输入你的问题
      </label>
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
        {rateLimit !== null && (
          <span
            className={[
              'rate-limit-indicator',
              rateLimitWarning(rateLimit) ? 'warn' : '',
              rateLimitDim(rateLimit) ? 'dim' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`每分钟最多提问 ${rateLimit.limit} 次，每分钟重置`}
            aria-label={`${formatRateLimit(rateLimit)}，每分钟重置`}
          >
            {formatRateLimit(rateLimit)}
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
      <div className="input-hint">
        <button
          type="button"
          className="input-hint-btn"
          aria-label="键盘快捷键说明"
          aria-describedby="input-kbd-tip"
          tabIndex={0}
        >
          ⌨
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
      {streaming && onStop ? (
        <button
          type="button"
          className="input-send input-stop"
          onClick={onStop}
          aria-label="停止生成"
          title="停止生成回复"
        >
          停止
        </button>
      ) : (
        <button
          type="button"
          className="input-send"
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="发送消息"
        >
          ↑
        </button>
      )}
      {/* P203: fixed-height row under the composer — empty while idle so
          the hint never shifts the textarea, send button, or message list. */}
      <div className="busy-enter-hint" role="status" aria-live="polite">
        {busyHintVisible ? BUSY_ENTER_HINT_TEXT : ''}
      </div>
    </div>
  );
});

export default InputBar;
