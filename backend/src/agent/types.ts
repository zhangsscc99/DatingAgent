export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: AgentContext) => Promise<string>;
}

export interface UserProfile {
  name?: string;
  age?: number;
  interests?: string[];
  goals?: string;
  personality?: string;
}

/** P339 — one durable fact extracted from a user message. */
export interface MemoryFact {
  /** Normalised dedupe key: lowercase, whitespace-stripped display text. */
  key: string;
  /** The fact as the capsule lists it. */
  text: string;
  /** Epoch millis when the fact was first remembered. */
  ts: number;
}

export interface AgentContext {
  sessionId: string;
  profile: UserProfile;
  conversationHistory: Message[];
  /** Reply language the user asked for; `auto` follows the conversation. */
  language?: ReplyLanguage;
  /** P339: facts the session remembers, written per user turn and
   * deletable via DELETE /api/conversations/:id/memory/:key. */
  memoryFacts?: MemoryFact[];
  /** P339: keys the user forgot — re-extraction never re-adds them, so a
   * deleted fact stays gone across later turns and history restores. */
  forgottenFactKeys?: Set<string>;
}

/** Languages the assistant can be pinned to. `auto` keeps the model's default behaviour. */
export type ReplyLanguage = 'zh' | 'en' | 'auto';

/** Reply-length hint. Absent keeps the model's default verbosity (P196). */
export type ReplyLength = 'concise' | 'detailed';

/**
 * P345 — which starter capsule opened the conversation. The three entries
 * are structural branches: each sends its own intent so the first-turn
 * reply follows a different skeleton instead of the shared
 * 归因 + 可照抄 + 解释 shape. Absent = typed by hand (today's shape).
 */
export type ChatIntent = 'profile' | 'chat-coach' | 'date-plan';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
  /** Provider-reported token usage; absent when the provider omits it. */
  usage?: TokenUsage;
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

/** Per-reply metadata surfaced as `meta` on /api/chat and in the SSE `done` event. */
export interface ChatReplyMeta {
  /** Name of the first tool used in the turn, if any. */
  tool?: string;
  /** Total tokens (prompt + completion) across all LLM calls; absent when unknown. */
  tokens?: number;
}

/** Non-streaming chat result: reply text plus its metadata. */
export interface ChatResult {
  content: string;
  meta: ChatReplyMeta;
}
