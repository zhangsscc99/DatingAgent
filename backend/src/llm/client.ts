import type { LLMResponse, Message, ToolCall, ToolDefinition } from '../agent/types.js';

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

/** One upstream SSE chunk (`stream: true`): content arrives as deltas. */
interface ChatCompletionChunkChoice {
  delta?: {
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface ChatCompletionChunk {
  choices?: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage;
}

/** Map a non-streamed chat-completion JSON body to LLMResponse. */
function completionToResponse(data: {
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}): LLMResponse {
  const choice = data.choices[0];
  return {
    content: choice.message.content,
    toolCalls: (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    })),
    finishReason:
      choice.finish_reason === 'tool_calls'
        ? 'tool_calls'
        : choice.finish_reason === 'length'
          ? 'length'
          : 'stop',
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/** Default upstream deadline; `LLM_TIMEOUT_MS` or a per-call arg can shrink it. */
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

/** Raised when the upstream call exceeds the deadline — distinct from a client abort. */
export class LLMTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = 'LLMTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Non-positive or non-numeric values fall back to the default. */
function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const candidate = timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_LLM_TIMEOUT_MS;
}

export class LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    this.model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<LLMResponse> {
    if (!this.isConfigured) {
      return this.mockResponse(messages, tools);
    }

    const body = this.requestBody(messages, tools);

    // One combined signal: our deadline plus the caller's disconnect signal
    // (P165). `AbortSignal.any` registers a single dependent listener on each
    // source and cleans them up when the fetch settles — no manual listeners
    // that could leak per request.
    const timeout = resolveTimeoutMs(timeoutMs);
    const timeoutSignal = AbortSignal.timeout(timeout);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let data: { choices: ChatCompletionChoice[]; usage?: ChatCompletionUsage };
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM API error ${res.status}: ${err}`);
      }

      data = (await res.json()) as {
        choices: ChatCompletionChoice[];
        usage?: ChatCompletionUsage;
      };
    } catch (err) {
      // Deadline fired while the caller signal did not: this is an upstream
      // timeout, not a client disconnect — report it as such.
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new LLMTimeoutError(timeout);
      }
      throw err;
    }

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content,
      toolCalls,
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  /** Shared request payload for chat() and chatStream() — identical fields. */
  private requestBody(messages: Message[], tools: ToolDefinition[]) {
    return {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      tools: tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: 'auto',
    };
  }

  /**
   * P189 — streaming variant of chat(): the same request plus `stream: true`.
   * Each upstream `delta.content` increment is yielded as it arrives, while
   * `delta.tool_calls` fragments are reassembled by `index` and their
   * `function.arguments` string is parsed once at the end. The generator's
   * return value is the same LLMResponse shape chat() produces — except
   * `finish_reason: 'length'` is reported faithfully instead of being
   * collapsed to 'stop'. Signal semantics match chat(): the per-call
   * deadline throws LLMTimeoutError, a caller abort propagates as-is.
   */
  async *chatStream(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    timeoutMs?: number,
    /**
     * P231: called with the accumulated function name every time an upstream
     * `delta.tool_calls` fragment extends it, so the caller can announce the
     * tool long before the call completes. Optional — omitting it changes
     * nothing.
     */
    onToolCallName?: (name: string) => void,
  ): AsyncGenerator<string, LLMResponse, unknown> {
    if (!this.isConfigured) {
      return this.mockResponse(messages, tools);
    }

    // Same combined signal as chat(): our deadline plus the caller's signal.
    const timeout = resolveTimeoutMs(timeoutMs);
    const timeoutSignal = AbortSignal.timeout(timeout);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ ...this.requestBody(messages, tools), stream: true }),
        signal: combinedSignal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM API error ${res.status}: ${err}`);
      }

      // A provider that ignores `stream: true` replies with a regular JSON
      // completion — parse it like chat() instead of hanging on SSE lines.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        const data = (await res.json()) as {
          choices: ChatCompletionChoice[];
          usage?: ChatCompletionUsage;
        };
        return completionToResponse(data);
      }

      if (!res.body) {
        throw new Error('LLM stream response has no body');
      }

      let content = '';
      let sawContent = false;
      let finishReason: string | null = null;
      let usage: ChatCompletionUsage | undefined;
      const toolParts = new Map<number, { id: string; name: string; arguments: string }>();

      // Lines can split across TCP chunks — buffer the tail of every read.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let upstreamDone = false;
      try {
        while (!upstreamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split('\n');
          buffered = lines.pop() ?? '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice('data:'.length).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              upstreamDone = true;
              break;
            }
            let chunk: ChatCompletionChunk;
            try {
              chunk = JSON.parse(payload) as ChatCompletionChunk;
            } catch {
              continue;
            }
            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;
            if (typeof delta?.content === 'string' && delta.content.length > 0) {
              sawContent = true;
              content += delta.content;
              yield delta.content;
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const part of delta.tool_calls) {
                const index = typeof part.index === 'number' ? part.index : 0;
                const slot = toolParts.get(index) ?? { id: '', name: '', arguments: '' };
                if (typeof part.id === 'string') slot.id += part.id;
                if (typeof part.function?.name === 'string') {
                  slot.name += part.function.name;
                  if (slot.name) onToolCallName?.(slot.name);
                }
                if (typeof part.function?.arguments === 'string') {
                  slot.arguments += part.function.arguments;
                }
                toolParts.set(index, slot);
              }
            }
            if (typeof choice.finish_reason === 'string') {
              finishReason = choice.finish_reason;
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }

      const toolCalls: ToolCall[] = [...toolParts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, slot]) => ({
          id: slot.id,
          name: slot.name,
          arguments: JSON.parse(slot.arguments || '{}') as Record<string, unknown>,
        }));

      return {
        content: sawContent ? content : null,
        toolCalls,
        finishReason:
          toolCalls.length > 0 ? 'tool_calls' : finishReason === 'length' ? 'length' : 'stop',
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    } catch (err) {
      // Same discrimination as chat(): an armed deadline with a live caller
      // signal is an upstream timeout — anything else rethrows untouched.
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new LLMTimeoutError(timeout);
      }
      throw err;
    }
  }

  /** Fallback when no API key — deterministic tool routing for demo */
  private mockResponse(messages: Message[], tools: ToolDefinition[]): LLMResponse {
    const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
    if (lastTool) {
      return this.synthesizeFromTool(lastTool);
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content.toLowerCase() ?? '';

    let toolName: string | null = null;
    if (/资料|profile|简介|bio|介绍自己/.test(text)) toolName = 'analyze_profile';
    else if (/聊天|回复|message|conversation|怎么说|话术/.test(text)) toolName = 'coach_conversation';
    else if (/约会|date|plan|安排|去哪/.test(text)) toolName = 'plan_date';
    else if (/匹配|合适|compatibility|性格|合不合/.test(text)) toolName = 'check_compatibility';
    else if (/建议|advice|help|帮助/.test(text)) toolName = 'get_relationship_advice';

    if (toolName && tools.some((t) => t.name === toolName)) {
      const args: Record<string, unknown> = {};
      if (toolName === 'coach_conversation') {
        args.scenario = lastUser?.content ?? '';
        args.tone = 'warm';
      } else if (toolName === 'plan_date') {
        args.interests = ['咖啡', '散步', '展览'];
        args.budget = 'medium';
      } else if (toolName === 'check_compatibility') {
        args.traits = lastUser?.content ?? '';
      } else if (toolName === 'analyze_profile') {
        args.bio = lastUser?.content ?? '';
      } else {
        args.question = lastUser?.content ?? '';
      }

      return {
        content: null,
        toolCalls: [{ id: `mock-${Date.now()}`, name: toolName, arguments: args }],
        finishReason: 'tool_calls',
      };
    }

    return {
      content:
        '你好！我是 DatingAgent，你的 AI 恋爱关系顾问。\n\n' +
        '我可以帮你：\n' +
        '• **优化个人资料** — 说「帮我看看资料怎么写」\n' +
        '• **聊天指导** — 说「对方说 XXX，我该怎么回」\n' +
        '• **约会规划** — 说「帮我安排一次约会」\n' +
        '• **匹配分析** — 说「分析一下我们的性格合不合」\n\n' +
        '请告诉我你想聊什么？',
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  private synthesizeFromTool(toolMsg: Message): LLMResponse {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(toolMsg.content) as Record<string, unknown>;
    } catch {
      parsed = { raw: toolMsg.content };
    }

    const name = toolMsg.toolName ?? 'tool';
    let content = '';

    switch (name) {
      case 'analyze_profile':
        content =
          `## 资料分析报告\n\n` +
          `**评分：** ${parsed.score ?? 'N/A'}/100\n\n` +
          `**优势：**\n${((parsed.strengths as string[]) ?? []).map((s) => `- ${s}`).join('\n')}\n\n` +
          `**改进建议：**\n${((parsed.improvements as string[]) ?? []).map((s) => `- ${s}`).join('\n')}\n\n` +
          `**优化示例：**\n> ${parsed.suggestedBio ?? ''}`;
        break;
      case 'coach_conversation':
        content =
          `## 聊天指导\n\n` +
          `**策略：** ${(parsed.analysis as { strategy?: string })?.strategy ?? '镜像 + 延伸'}\n\n` +
          `**推荐回复：**\n` +
          ((parsed.suggestedReplies as { text: string; why: string }[]) ?? [])
            .map((r, i) => `${i + 1}. 「${r.text}」\n   _${r.why}_`)
            .join('\n\n') +
          `\n\n**避免：** ${((parsed.avoid as string[]) ?? []).join('、')}`;
        break;
      case 'plan_date':
        content =
          `## 约会方案\n\n` +
          ((parsed.plans as { title: string; duration: string; activities: string[]; why: string; budget: string }[]) ?? [])
            .map(
              (p, i) =>
                `### 方案 ${i + 1}：${p.title}\n` +
                `- 时长：${p.duration}\n- 预算：${p.budget}\n- 理由：${p.why}\n` +
                `- 活动：${p.activities.join(' → ')}`,
            )
            .join('\n\n');
        break;
      case 'check_compatibility':
        content =
          `## 匹配度分析\n\n` +
          `**综合得分：** ${parsed.overallScore ?? 'N/A'}/100\n\n` +
          ((parsed.dimensions as { name: string; score: number; note: string }[]) ?? [])
            .map((d) => `- **${d.name}** ${d.score}分 — ${d.note}`)
            .join('\n') +
          `\n\n**优势：** ${((parsed.strengths as string[]) ?? []).join('；')}\n` +
          `**注意：** ${((parsed.watchouts as string[]) ?? []).join('；')}`;
        break;
      default:
        content =
          `## 关系建议\n\n` +
          ((parsed.advice as string[]) ?? ['保持真诚，尊重边界']).map((a) => `- ${a}`).join('\n');
    }

    return { content, toolCalls: [], finishReason: 'stop' };
  }
}
