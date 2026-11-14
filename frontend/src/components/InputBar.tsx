import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import './InputBar.css';

export interface InputBarHandle {
  focus: () => void;
}

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

/** Must match MAX_MESSAGE_CHARS in backend/src/lib/guardrails.ts (413 above it). */
const MAX_MESSAGE_CHARS = 4000;
/** Show the counter once the user is close to the cap. */
const COUNTER_THRESHOLD = 3600;

/** Show ⌘ on Apple platforms, Ctrl elsewhere — purely cosmetic hint text. */
const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

const InputBar = forwardRef<InputBarHandle, Props>(function InputBar({ onSend, disabled }, ref) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc: drop focus out of the composer (mobile keyboard dismissal, Tab-out on desktop).
    if (e.key === 'Escape') {
      e.preventDefault();
      textareaRef.current?.blur();
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
      <label htmlFor="chat-input" className="sr-only">
        输入你的问题
      </label>
      <div className={showCounter ? 'input-field has-counter' : 'input-field'}>
        <textarea
          ref={textareaRef}
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你的问题，例如：对方说「在干嘛」，我该怎么回？"
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          disabled={disabled}
          aria-label="输入你的问题"
          aria-disabled={disabled}
          aria-describedby={showCounter ? 'chat-input-counter' : undefined}
          title={`Enter 发送 · Shift+Enter 换行 · ${MOD_KEY}+Enter 发送 · Esc 收起输入`}
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
            <kbd>Esc</kbd> 收起输入框
          </span>
        </div>
      </div>
      <button
        type="button"
        className="input-send"
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="发送消息"
      >
        ↑
      </button>
    </div>
  );
});

export default InputBar;
