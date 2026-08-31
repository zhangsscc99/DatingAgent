import { useState, type FormEvent, type KeyboardEvent } from 'react';
import './InputBar.css';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function InputBar({ onSend, disabled }: Props) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="input-bar">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你的问题，例如：对方说「在干嘛」，我该怎么回？"
        rows={1}
        disabled={disabled}
      />
      <button onClick={submit} disabled={disabled || !text.trim()} aria-label="发送">
        ↑
      </button>
    </div>
  );
}
