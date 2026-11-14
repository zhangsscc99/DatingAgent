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

export interface AgentContext {
  sessionId: string;
  profile: UserProfile;
  conversationHistory: Message[];
  /** Reply language the user asked for; `auto` follows the conversation. */
  language?: ReplyLanguage;
}

/** Languages the assistant can be pinned to. `auto` keeps the model's default behaviour. */
export type ReplyLanguage = 'zh' | 'en' | 'auto';

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
  type: 'thinking' | 'tool_start' | 'tool_end' | 'message' | 'error' | 'done';
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
