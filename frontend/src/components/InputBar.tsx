import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { loadInputHistory } from '../lib/inputHistory';
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
}

/** Must match MAX_MESSAGE_CHARS in backend/src/lib/guardrails.ts (413 above it). */
const MAX_MESSAGE_CHARS = 4000;
/** Show the counter once the user is close to the cap. */
const COUNTER_THRESHOLD = 3600;
/** Persisted drafts are capped at 4 KB so localStorage stays small. */
const MAX_DRAFT_CHARS = 4096;

function draftStorageKey(draftKey: string): string {
  return `datingagent-draft:${draftKey}`;
}

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

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar(
  { onSend, disabled, streaming = false, onStop, draftKey },
  ref,
) {
  const draftId = draftKey ?? 'default';
  const [text, setText] = useState(() => loadDraft(draftId));
  const draftIdRef = useRef(draftId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // P06: terminal-style recall of sent messages. `historyPos` counts steps
  // back from the newest entry (null = not browsing); `browseDraft` holds
  // the text that was in the box when browsing started so it is never lost.
  const historyPosRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const browseDraftRef = useRef('');
  const [historyAnnouncement, setHistoryAnnouncement] = useState('');

  // Session switch: load that session's draft (the old one is already persisted).
  useEffect(() => {
    if (draftIdRef.current === draftId) return;
    draftIdRef.current = draftId;
    setText(loadDraft(draftId));
  }, [draftId]);

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
      historyRef.current = loadInputHistory();
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

    if (e.key !== 'Enter') return;

    // Shift+Enter keeps the default newline behaviour.
    if (e.shiftKey) return;

    // Enter or Ctrl/Cmd+Enter both send.
    e.preventDefault();
    submit();
  };

  const showCounter = text.length >= COUNTER_THRESHOLD;

  return (
    <div className="input-bar" role="form" aria-label="发送消息">
      <span className="sr-only" role="status" aria-live="polite">
        {historyAnnouncement}
      </span>
      <label htmlFor="chat-input" className="sr-only">
        输入你的问题
      </label>
      <div className={showCounter ? 'input-field has-counter' : 'input-field'}>
        <textarea
          ref={textareaRef}
          id="chat-input"
          value={text}
          onChange={(e) => {
            // P06: typing or pasting leaves history-browse mode.
            historyPosRef.current = null;
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="描述你的问题，例如：对方说「在干嘛」，我该怎么回？"
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          disabled={disabled}
          aria-label="输入你的问题"
          aria-disabled={disabled}
          aria-describedby={showCounter ? 'chat-input-counter' : undefined}
          title={`Enter 发送 · Shift+Enter 换行 · ${MOD_KEY}+Enter 发送 · ↑ 历史消息 · Esc 收起输入`}
        />
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
    </div>
  );
});

export default InputBar;
