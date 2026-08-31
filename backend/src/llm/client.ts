import type { LLMResponse, Message, ToolCall, ToolDefinition } from '../agent/types.js';

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
  ): Promise<LLMResponse> {
    if (!this.isConfigured) {
      return this.mockResponse(messages, tools);
    }

    const body = {
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

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { choices: ChatCompletionChoice[] };
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
    };
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
