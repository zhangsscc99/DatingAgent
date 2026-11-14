import { v4 as uuidv4 } from 'uuid';
import type { AgentContext, AgentEvent, ChatResult, Message, ReplyLanguage } from './types.js';
import { LLMClient } from '../llm/client.js';
import { usageMetrics } from '../lib/metrics.js';
import { getTool, toolRegistry } from '../tools/registry.js';

const SYSTEM_PROMPT = `你是 DatingAgent，一位专业、温暖、有边界感的 AI 恋爱关系顾问。

你的职责：
- 帮助用户优化交友资料，提升真实吸引力
- 提供聊天沟通建议，强调真诚与共情
- 规划轻松自然的约会方案
- 分析关系匹配度，给出建设性建议

原则：
- 尊重对方意愿和边界，拒绝操控、PUA 等不道德建议
- 鼓励真诚沟通，而非套路和欺骗
- 回复简洁清晰，使用 Markdown 格式
- 当需要专业分析时，主动调用工具

用户资料：{{profile}}`;

/** Appended to the system prompt only when the user pins a language. */
const LANGUAGE_DIRECTIVES: Record<ReplyLanguage, string> = {
  auto: '',
  zh: '\n\n回复语言：始终用简体中文回答，即使提问使用的是其他语言。',
  en: '\n\nReply language: Always answer in English, even when the question is asked in another language.',
};

/** Accepted `language` values on the chat endpoints. */
export const REPLY_LANGUAGES: readonly ReplyLanguage[] = ['zh', 'en', 'auto'];

/** Returns the language when it is one of REPLY_LANGUAGES, otherwise undefined. */
export function parseReplyLanguage(value: unknown): ReplyLanguage | undefined {
  return typeof value === 'string' && (REPLY_LANGUAGES as readonly string[]).includes(value)
    ? (value as ReplyLanguage)
    : undefined;
}

/** System prompt for one turn: profile injected, plus the optional language directive. */
export function buildSystemPrompt(
  profile: AgentContext['profile'],
  language: ReplyLanguage = 'auto',
): string {
  return (
    SYSTEM_PROMPT.replace('{{profile}}', JSON.stringify(profile, null, 2)) +
    LANGUAGE_DIRECTIVES[language]
  );
}

export class AgentHarness {
  private llm = new LLMClient();
  private maxTurns = 8;

  async *run(userMessage: string, context: AgentContext): AsyncGenerator<AgentEvent> {
    const messages: Message[] = [
      {
        role: 'system',
        content: buildSystemPrompt(context.profile, context.language ?? 'auto'),
      },
      ...context.conversationHistory,
      { role: 'user', content: userMessage },
    ];

    // F21: metadata collected across the whole turn for the reply badge.
    const toolsUsed: string[] = [];
    let tokens: number | undefined;

    yield { type: 'thinking', data: { message: '正在思考…' } };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.llm.chat(messages, toolRegistry);
      if (response.usage) {
        usageMetrics.recordTokens(response.usage.promptTokens, response.usage.completionTokens);
        tokens = (tokens ?? 0) + response.usage.promptTokens + response.usage.completionTokens;
      }

      if (response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
        });

        for (const call of response.toolCalls) {
          toolsUsed.push(call.name);
          const tool = getTool(call.name);
          if (!tool) {
            yield { type: 'error', data: { message: `Unknown tool: ${call.name}` } };
            continue;
          }

          yield {
            type: 'tool_start',
            data: { name: call.name, arguments: call.arguments },
          };

          try {
            const result = await tool.execute(call.arguments, context);
            messages.push({
              role: 'tool',
              content: result,
              toolCallId: call.id,
              toolName: call.name,
            });

            yield {
              type: 'tool_end',
              data: { name: call.name, result: JSON.parse(result) },
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: msg }),
              toolCallId: call.id,
              toolName: call.name,
            });
            yield { type: 'error', data: { message: msg } };
          }
        }
        continue;
      }

      const finalContent =
        response.content ??
        '抱歉，我暂时无法生成回复。请换个方式描述你的问题。';

      messages.push({ role: 'assistant', content: finalContent });
      context.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: finalContent },
      );

      yield { type: 'message', data: { content: finalContent, role: 'assistant' } };
      yield {
        type: 'done',
        data: { sessionId: context.sessionId, tool: toolsUsed[0], tokens },
      };
      return;
    }

    yield {
      type: 'message',
      data: {
        content: '对话轮次已达上限，请开启新话题或刷新会话。',
        role: 'assistant',
      },
    };
    yield {
      type: 'done',
      data: { sessionId: context.sessionId, tool: toolsUsed[0], tokens },
    };
  }

  /** Non-streaming convenience wrapper */
  async chat(userMessage: string, context: AgentContext): Promise<string> {
    const { content } = await this.chatWithMeta(userMessage, context);
    return content;
  }

  /** Non-streaming chat that also returns the reply metadata (F21). */
  async chatWithMeta(userMessage: string, context: AgentContext): Promise<ChatResult> {
    let content = '';
    let tool: string | undefined;
    let tokens: number | undefined;
    for await (const event of this.run(userMessage, context)) {
      if (event.type === 'message') {
        content = (event.data as { content: string }).content;
      }
      if (event.type === 'done') {
        const d = event.data as { tool?: string; tokens?: number };
        tool = d.tool;
        tokens = d.tokens;
      }
    }
    return { content, meta: { tool, tokens } };
  }
}

export function createSession(
  profile: AgentContext['profile'] = {},
  language: ReplyLanguage = 'auto',
): AgentContext {
  return {
    sessionId: uuidv4(),
    profile,
    conversationHistory: [],
    language,
  };
}
