export interface UserProfile {
  name?: string;
  age?: number;
  interests?: string[];
  goals?: string;
  personality?: string;
}

export type StreamPhase = 'thinking' | 'tool' | 'generating';

/** Mirrors ReplyLanguage in backend/src/agent/types.ts. */
export type ReplyLanguage = 'zh' | 'en' | 'auto';

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
  /** Stream or request failed — show retry UI */
  error?: boolean;
  /** Original user prompt to resend on retry */
  retryPrompt?: string;
}

export interface ToolEvent {
  name: string;
  label: string;
  status: 'running' | 'done';
  result?: unknown;
}

export interface ToolInfo {
  name: string;
  label: string;
  icon: string;
}

export interface AgentEvent {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'message' | 'error' | 'done';
  data: unknown;
}
