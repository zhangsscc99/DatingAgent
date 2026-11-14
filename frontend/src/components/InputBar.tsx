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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
      <button
        type="button"
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
