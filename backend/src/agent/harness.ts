import { v4 as uuidv4 } from 'uuid';
import type { AgentContext, AgentEvent, ChatResult, Message, ReplyLanguage, ReplyLength } from './types.js';
import { LLMClient } from '../llm/client.js';
import { capHistory, historyLimitsFromEnv } from '../lib/history.js';
import { resolveFocusEntity } from '../lib/focusEntity.js';
import { usageMetrics } from '../lib/metrics.js';
import { stripManualLabels, stripStageDirections } from '../lib/reply-clean.js';
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
- 不要使用 emoji 或表情符号装饰回复，只用纯文本与 Markdown 结构。
- 禁止角色扮演：你是顾问，不是用户的恋人或暧昧对象，永远不进入伴侣人设；不写（）或 () 包裹的舞台提示/动作描写，不用「乖」「摸摸」「抱抱」「宝贝」等亲昵称呼，不描写摸头、拥抱等任何肢体接触；用户情绪脆弱时先以顾问身份共情，再给出可以直接照抄发给对方的话术或一条可执行建议。
- 短输入配短回复：当用户最新消息不足 6 个字，或只是语气词（嗯、哦、好、在、唉、啊、随便、行吧，可带标点）时，回复最多 3 个短段落，不设小标题、不用编号或要点清单、不写「可以这样做」「接下来 N 小时内」式框架，也不主动规划约会或列话术；先用一句话回应对方的感受，再给最多一条具体建议，最后用一个短问句请对方多说一点。用户明确要求「详细」时不受此限。
- 高情绪场景先接住人再给最少行动：当用户的问题是「首次见家长」「见父母」「第一次见对方家人」这类让人紧张的场合时，先用一句话安抚情绪、肯定他的重视；然后最多给三条可执行动作，覆盖穿什么、带什么、开场怎么开口，各写一行短句；不用 Markdown 标题、不设小节、不展开成清单；最后用一句追问收尾，例如「想先细聊哪一块？」，把详细展开留给下一轮。用户明确要求「详细」时不受此限。
- 准备/注意事项类问题给短答不给手册：当用户问「要准备什么」「需要注意什么」「有什么清单」这类准备事项时，最多 3 个短段落、最多 3 条要点；不设 h3 编号小标题、不用 ## 标题分节，示例话术写成行内引号（“…”）而不是 blockquote 引用块。用户明确要求「详细」或「完整清单」时不受此限。
- 话术类提问先给原话：当用户问「怎么回」「怎么接」「要不要发」「该不该回」这类要一句回复话术的问题时，第一段必须是一句可直接发送的原话（用引号包裹），随后最多 2 句理由，最多再给 1 句备选原话；禁止「选项一」「选项二」「解析：」「避坑指南」这类手册化标签，不用 emoji 小标题、不设编号小节；总长控制在约 200 字以内。用户明确要求「多给几种」或「详细」时不受此限。
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

/** Appended to the system prompt only when the user picks a non-default reply length (P196). */
const REPLY_LENGTH_DIRECTIVES: Record<ReplyLength, string> = {
  concise: '\n\n请把回复写得更精简，控制在三点以内。',
  detailed: '\n\n请把回复写得更详细一些，给出更完整的步骤和例子。',
};

/** Accepted `replyLength` values on the chat endpoints. */
export const REPLY_LENGTHS: readonly ReplyLength[] = ['concise', 'detailed'];

/** Returns the length when it is one of REPLY_LENGTHS, otherwise undefined. */
export function parseReplyLength(value: unknown): ReplyLength | undefined {
  return typeof value === 'string' && (REPLY_LENGTHS as readonly string[]).includes(value)
    ? (value as ReplyLength)
    : undefined;
}

/**
 * P210 — per-run ceiling on executed tool calls. One user question used to
 * serialise three tool calls (get_relationship_advice → coach_conversation
 * → plan_date), each a full upstream round trip, pushing a single reply to
 * 43–70 s. Capping the budget makes the model answer from the tool results
 * it already has. `TOOL_CALL_BUDGET` overrides the default for ops tuning;
 * values are clamped to 1..4, anything else falls back to the default.
 */
export const TOOL_CALL_BUDGET_DEFAULT = 2;
export const TOOL_CALL_BUDGET_MIN = 1;
export const TOOL_CALL_BUDGET_MAX = 4;

export function toolCallBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.TOOL_CALL_BUDGET ?? '').trim();
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return TOOL_CALL_BUDGET_DEFAULT;
  return Math.min(TOOL_CALL_BUDGET_MAX, Math.max(TOOL_CALL_BUDGET_MIN, Math.floor(parsed)));
}

/**
 * P231 — heartbeat cadence for `tool_progress` events while a tool handler
 * is running. Today's handlers are in-process and finish in milliseconds,
 * but a genuinely slow one used to leave the client without any event for
 * the whole await. `TOOL_PROGRESS_HEARTBEAT_MS` overrides for tests/ops;
 * non-positive or non-numeric values fall back to the default.
 */
export const TOOL_PROGRESS_HEARTBEAT_MS_DEFAULT = 5_000;

export function toolProgressHeartbeatMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TOOL_PROGRESS_HEARTBEAT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TOOL_PROGRESS_HEARTBEAT_MS_DEFAULT;
}

/**
 * P210: appended to the prompt once the tool budget is spent, so the
 * tool-free turn answers from the results already collected.
 */
const TOOL_BUDGET_SPENT_DIRECTIVE =
  '工具结果已足够，请直接基于已获得的信息作答，不要再调用工具。';

/**
 * P210: deterministic last resort — a run must never end on an empty
 * assistant bubble, so a budget-capped model that still returns no text
 * gets a reply built from the tool calls it already ran.
 */
function fallbackFromToolResults(messages: Message[]): string {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolName) names.add(m.toolName);
  }
  if (names.size === 0) {
    return '抱歉，我暂时无法生成回复。请换个方式描述你的问题。';
  }
  return (
    `我调用了 ${[...names].join('、')} 拿到了相关信息，但没能把它整理成通顺的回复。` +
    '换个方式再问一次，或只说你最关心的一点，我直接回答。'
  );
}

/** System prompt for one turn: profile injected, plus the optional language and length directives. */
export function buildSystemPrompt(
  profile: AgentContext['profile'],
  language: ReplyLanguage = 'auto',
  replyLength?: ReplyLength,
): string {
  return (
    SYSTEM_PROMPT.replace('{{profile}}', JSON.stringify(profile, null, 2)) +
    LANGUAGE_DIRECTIVES[language] +
    (replyLength ? REPLY_LENGTH_DIRECTIVES[replyLength] : '')
  );
}

/**
 * P233 — per-turn person-focus constraint appended to the system message.
 * When the current message names someone (「她」) while the last turns only
 * named somebody else (「我妈」), the model otherwise keeps writing about
 * the stale person. Returns '' when there is nothing to constrain.
 */
export function buildFocusDirective(history: Message[], currentMessage: string): string {
  const { directive } = resolveFocusEntity(history, currentMessage);
  return directive ? '\n\n' + directive : '';
}

export class AgentHarness {
  private llm = new LLMClient();
  private maxTurns = 8;

  async *run(
    userMessage: string,
    context: AgentContext,
    signal?: AbortSignal,
    replyLength?: ReplyLength,
  ): AsyncGenerator<AgentEvent> {
    const messages: Message[] = [
      {
        role: 'system',
        content:
          buildSystemPrompt(context.profile, context.language ?? 'auto', replyLength) +
          buildFocusDirective(context.conversationHistory, userMessage),
      },
      // P177: bound the prompt — keep the newest turns within the
      // HISTORY_MAX_MESSAGES / HISTORY_MAX_CHARS budget.
      ...capHistory(context.conversationHistory, historyLimitsFromEnv()),
      { role: 'user', content: userMessage },
    ];

    // F21: metadata collected across the whole turn for the reply badge.
    const toolsUsed: string[] = [];
    let tokens: number | undefined;
    // P210: total executed-tool-call budget for this run — counting calls,
    // not turns, so a multi-call response also spends it.
    const toolBudget = toolCallBudgetFromEnv();
    const progressHeartbeatMs = toolProgressHeartbeatMs();
    let toolCallsExecuted = 0;
    let budgetDirectiveAdded = false;

    yield { type: 'thinking', data: { message: '正在思考…' } };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      // Client already gone: stop before starting (and paying for) another turn.
      if (signal?.aborted) return;

      // P231: after a tool ran, the follow-up model call can sit silent for
      // many seconds before its first delta (measured 6.7–20 s on tool
      // turns). Name the tool whose result is being written up so the
      // client can keep tool-named progress copy on screen for that wait.
      const lastToolName = toolsUsed.at(-1);
      if (lastToolName) {
        yield {
          type: 'tool_progress',
          data: { name: lastToolName, phase: 'summarizing', elapsedMs: 0 },
        };
      }

      // P210: once the budget is spent, the next turn offers no tools at
      // all and carries a directive telling the model to answer from the
      // results already collected — no more serialized round trips.
      const budgetSpent = toolCallsExecuted >= toolBudget;
      if (budgetSpent && !budgetDirectiveAdded) {
        messages.push({ role: 'system', content: TOOL_BUDGET_SPENT_DIRECTIVE });
        budgetDirectiveAdded = true;
      }

      // P231: the upstream tool_calls stream reveals the function name long
      // before the call completes — queue each registry-confirmed name and
      // flush it as a `calling` progress event, so the bubble names the
      // tool during the selection wait instead of only after tool_start.
      const announcedTools = new Set<string>();
      const pendingToolNames: string[] = [];
      const onToolCallName = (name: string) => {
        if (!getTool(name) || announcedTools.has(name)) return;
        announcedTools.add(name);
        pendingToolNames.push(name);
      };

      // P189: stream the reply — each upstream token goes out as a `delta`
      // event so the client bubble grows while the model is still writing.
      // The generator's return value is the turn's authoritative response.
      const stream = this.llm.chatStream(
        messages,
        budgetSpent ? [] : toolRegistry,
        signal,
        undefined,
        onToolCallName,
      );
      let accumulated = '';
      let step = await stream.next();
      while (!step.done) {
        while (pendingToolNames.length > 0) {
          yield {
            type: 'tool_progress',
            data: { name: pendingToolNames.shift()!, phase: 'calling', elapsedMs: 0 },
          };
        }
        accumulated += step.value;
        yield { type: 'delta', data: { content: step.value } };
        step = await stream.next();
      }
      // A name can land in the same final chunk that closed the stream —
      // flush it so it still reaches the client before tool_start.
      while (pendingToolNames.length > 0) {
        yield {
          type: 'tool_progress',
          data: { name: pendingToolNames.shift()!, phase: 'calling', elapsedMs: 0 },
        };
      }
      const response = step.value;

      if (response.usage) {
        usageMetrics.recordTokens(response.usage.promptTokens, response.usage.completionTokens);
        tokens = (tokens ?? 0) + response.usage.promptTokens + response.usage.completionTokens;
      }

      if (response.toolCalls.length > 0 && !budgetSpent) {
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
        });

        // A turn that streamed text before deciding to call tools: pin the
        // draft to the authoritative content before the tool phase, so the
        // client bubble matches what history will record.
        const turnContent = response.content ?? accumulated;
        if (turnContent) {
          yield {
            type: 'message',
            data: { content: turnContent, role: 'assistant' },
          };
        }

        // P210: a response can hold more calls than the remaining budget —
        // execute only what fits, so executions never exceed the cap.
        for (const call of response.toolCalls.slice(0, toolBudget - toolCallsExecuted)) {
          toolsUsed.push(call.name);
          const tool = getTool(call.name);
          if (!tool) {
            yield { type: 'error', data: { message: `Unknown tool: ${call.name}` } };
            continue;
          }

          toolCallsExecuted += 1;
          yield {
            type: 'tool_start',
            data: { name: call.name, arguments: call.arguments },
          };

          // P231: the tool phase used to be the quietest part of the turn —
          // an immediate progress event plus a heartbeat while the handler
          // runs keeps the bubble naming the active tool with an elapsed
          // counter for the whole wait.
          const toolStartedAt = Date.now();
          yield {
            type: 'tool_progress',
            data: { name: call.name, phase: 'calling', elapsedMs: 0 },
          };

          try {
            const execution = tool.execute(call.arguments, context).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ ok: false as const, error }),
            );
            const settled = execution.then(() => 'settled' as const);
            for (;;) {
              const winner = await Promise.race([
                settled,
                new Promise<'tick'>((resolve) =>
                  setTimeout(() => resolve('tick'), progressHeartbeatMs),
                ),
              ]);
              if (winner === 'settled') break;
              if (signal?.aborted) return;
              yield {
                type: 'tool_progress',
                data: {
                  name: call.name,
                  phase: 'calling',
                  elapsedMs: Date.now() - toolStartedAt,
                },
              };
            }
            const outcome = await execution;
            if (!outcome.ok) throw outcome.error;
            const result = outcome.value;
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

      // P210: a run must never end on an empty assistant message — when the
      // model returns no text (e.g. it still wanted tools after the budget
      // was spent), answer deterministically from what was collected.
      // P242: strip parenthesised stage directions before the reply is
      // persisted; if cleaning empties it, fall back the same way.
      // P279: also strip manual-style labels (「解析：」「避坑指南：」and
      // leading emoji) so the persisted and final streamed text agree.
      const cleanedContent = stripManualLabels(stripStageDirections(response.content ?? ''));
      const finalContent = cleanedContent.trim()
        ? cleanedContent
        : fallbackFromToolResults(messages);

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
  async chatWithMeta(
    userMessage: string,
    context: AgentContext,
    replyLength?: ReplyLength,
  ): Promise<ChatResult> {
    let content = '';
    let tool: string | undefined;
    let tokens: number | undefined;
    for await (const event of this.run(userMessage, context, undefined, replyLength)) {
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
