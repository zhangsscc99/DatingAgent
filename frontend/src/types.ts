export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
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
