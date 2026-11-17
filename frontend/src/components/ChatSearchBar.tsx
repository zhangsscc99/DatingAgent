import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { isSearching } from '../lib/messageSearch';
import {
  FIND_IN_CONVERSATION_CLOSE_LABEL,
  FIND_IN_CONVERSATION_LABEL,
  FIND_IN_CONVERSATION_NEXT_LABEL,
  FIND_IN_CONVERSATION_PLACEHOLDER,
  FIND_IN_CONVERSATION_PREV_LABEL,
} from '../lib/searchLabels';
import './ChatSearchBar.css';

interface Props {
  query: string;
  matchCount: number;
  activeIndex: number;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/**
 * P19: single-row search bar floating over the message list. Stateless — the
 * filtering itself lives in ChatWindow via lib/messageSearch.
 */
export default function ChatSearchBar({
  query,
  matchCount,
  activeIndex,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keys are scoped to the bar itself — nothing outside it is intercepted.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const status = !isSearching(query)
    ? ''
    : matchCount === 0
      ? '无匹配'
      : `${activeIndex + 1} / ${matchCount} 条匹配`;

  return (
    <div className="chat-search-bar" role="search" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        type="search"
        className="chat-search-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={FIND_IN_CONVERSATION_PLACEHOLDER}
        aria-label={FIND_IN_CONVERSATION_LABEL}
      />
      <span className="chat-search-status" role="status" aria-live="polite">
        {status}
      </span>
      <button
        type="button"
        className="chat-search-btn"
        aria-label={FIND_IN_CONVERSATION_PREV_LABEL}
        title={FIND_IN_CONVERSATION_PREV_LABEL}
        onClick={onPrev}
        disabled={matchCount === 0}
      >
        ↑
      </button>
      <button
        type="button"
        className="chat-search-btn"
        aria-label={FIND_IN_CONVERSATION_NEXT_LABEL}
        title={FIND_IN_CONVERSATION_NEXT_LABEL}
        onClick={onNext}
        disabled={matchCount === 0}
      >
        ↓
      </button>
      <button
        type="button"
        className="chat-search-btn"
        aria-label={FIND_IN_CONVERSATION_CLOSE_LABEL}
        title={FIND_IN_CONVERSATION_CLOSE_LABEL}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
