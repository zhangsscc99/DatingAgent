import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import './InputBar.css';

export interface InputBarHandle {
  focus: () => void;
}

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

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

  return (
    <div className="input-bar" role="form" aria-label="发送消息">
      <label htmlFor="chat-input" className="sr-only">
        输入你的问题
      </label>
      <textarea
        ref={textareaRef}
        id="chat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你的问题，例如：对方说「在干嘛」，我该怎么回？"
        rows={1}
        disabled={disabled}
        aria-label="输入你的问题"
        aria-disabled={disabled}
      />
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
