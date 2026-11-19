export interface UserProfile {
  name?: string;
  age?: number;
  interests?: string[];
  goals?: string;
  personality?: string;
}

export type StreamPhase = 'thinking' | 'tool' | 'generating';

/** P231: which stage of the tool lifecycle the wait copy should describe. */
export type ToolPhaseKind = 'calling' | 'summarizing';

/** Mirrors ReplyLanguage in backend/src/agent/types.ts. */
export type ReplyLanguage = 'zh' | 'en' | 'auto';

/**
 * P345: which welcome starter capsule composed this message — mirrors
 * ChatIntent in backend/src/agent/types.ts. Sent only on the first turn a
 * starter produced; a hand-typed message sends no intent.
 */
export type ChatIntent = 'profile' | 'chat-coach' | 'date-plan';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Epoch millis when the bubble was created (used by the Markdown export) */
  createdAt?: number;
  toolEvents?: ToolEvent[];
  /** True while SSE stream is active for this message */
  streaming?: boolean;
  streamPhase?: StreamPhase;
  /** P231: `calling` while a tool runs, `summarizing` while its result is written up. */
  toolPhase?: ToolPhaseKind;
  /** Stream or request failed — show retry UI */
  error?: boolean;
  /** Failure detail shown under a restored reply after a failed regen (P26) */
  errorDetail?: string;
  /** Original user prompt to resend on retry */
  retryPrompt?: string;
  /** True while this reply is being regenerated in place (P26) */
  regenerating?: boolean;
  /** Generation was stopped by the user — keep the partial text (P12) */
  stopped?: boolean;
  /** Per-reply metadata badge (F21); hidden when tokens are unknown */
  meta?: ReplyMeta;
  /**
   * P276: the version 换一个 swapped out — shown while the newest reply is
   * displayed (「恢复上一版」). One slot only, in-memory: serializeMessages
   * drops it so a refresh keeps whichever text was showing.
   */
  previousVersion?: ReplyVersionSnapshot;
  /**
   * P276: the newer reply parked while the stored previous version is being
   * viewed — 「查看新版」 swaps it back. Never set at the same time as
   * previousVersion.
   */
  newerVersion?: ReplyVersionSnapshot;
  /**
   * P332: 1-based index of the reply version currently on screen — the first
   * generation leaves it undefined (no 「第 N 版」 label), each successful
   * 换一个 bumps it, and the P276 swap carries it through the parked
   * snapshots so the badge always names the displayed text. In-memory only:
   * serializeMessages drops it like the version slots.
   */
  versionIndex?: number;
  /**
   * P284: the last 「换一个」 came back identical to the version it replaced.
   * The bubble keeps the original text, hides the fake fresh latency row and
   * shows 「这一版和上一版一样，再试一次？」 instead. In-memory only.
   */
  duplicateRegen?: boolean;
  /**
   * P335: 「换一个」 rolls already spent on this reply — at REGEN_ROLL_LIMIT
   * the button locks until regenCooldownUntil. In-memory only like
   * versionIndex (serializeMessages drops it); the App-owned cooldown
   * timeout clears both fields so the next window grants a fresh budget.
   */
  regenRolls?: number;
  /** P335: epoch millis when the re-roll lock lifts; unset while live. */
  regenCooldownUntil?: number;
}

export interface ReplyMeta {
  tool?: string;
  latencyMs?: number;
  tokens?: number;
}

/** P339: one durable fact the backend keeps for a conversation. */
export interface MemoryFact {
  /** Normalised dedupe key — the id DELETE /api/conversations/:id/memory/:key takes. */
  key: string;
  /** The fact text the capsule lists. */
  text: string;
  /** Epoch millis when the fact was first remembered. */
  ts: number;
}

/** P339: the server-held memory of one conversation (GET .../memory shape). */
export interface ConversationMemory {
  count: number;
  items: MemoryFact[];
}

/** P276: one parked reply version — what the bubble looked like before the
 * current text replaced it. */
export interface ReplyVersionSnapshot {
  content: string;
  toolEvents?: ToolEvent[];
  meta?: ReplyMeta;
  stopped?: boolean;
  /** P332: the versionIndex this snapshot was showing when parked. */
  versionIndex?: number;
}

export interface ToolEvent {
  name: string;
  label: string;
  /** P397: 'failed' — the call could not produce a result (unavailable or thrown). */
  status: 'running' | 'done' | 'failed';
  result?: unknown;
}

export interface ToolInfo {
  name: string;
  label: string;
  icon: string;
}

export interface AgentEvent {
  type:
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'tool_progress'
    | 'delta'
    | 'message'
    | 'error'
    | 'done';
  data: unknown;
}
