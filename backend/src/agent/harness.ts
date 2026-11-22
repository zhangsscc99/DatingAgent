import { v4 as uuidv4 } from 'uuid';
import type { AgentContext, AgentEvent, ChatIntent, ChatResult, Message, ReplyLanguage, ReplyLength } from './types.js';
import type { ReplyStrategy } from '../lib/reply-strategy.js';
import {
  REPLY_STRATEGIES,
  REPLY_STRATEGY_HINTS,
  REPLY_STRATEGY_LABELS,
  ReplyStrategyLedger,
  extractReplyStrategy,
  hasRegenMetaReport,
  stripRegenMetaReport,
} from '../lib/reply-strategy.js';
import { LLMClient } from '../llm/client.js';
import { capHistory, historyLimitsFromEnv } from '../lib/history.js';
import { resolveFocusEntity } from '../lib/focusEntity.js';
import { usageMetrics } from '../lib/metrics.js';
import { matchesAnyReply } from '../lib/reply-dedupe.js';
import {
  CLINIC_TERMS,
  fillBracketSlots,
  normalizeChinesePunctuation,
  normalizeCjkQuotes,
  softenClinicTerms,
  stripManualLabels,
  stripPromptEcho,
  stripSpaceAfterCjkPunct,
  stripStageDirections,
} from '../lib/reply-clean.js';
import { getTool, toolRegistry } from '../tools/registry.js';

/**
 * P286 — the 「帮我优化资料」 chip used to earn back only a four-question
 * questionnaire and zero sample copy. This rule is the single source of
 * truth for the profile-optimisation intent: it lives inside SYSTEM_PROMPT
 * for every turn, and buildProfileIntentDirective restates it at the tail
 * of the system message when the current user message matches the intent.
 */
export const PROFILE_EXAMPLE_FIRST_RULE =
  '资料优化类提问先给示例再提问：当用户想优化或改写交友资料、个人简介、交友文案' +
  '（说「资料优化」「帮我优化资料」「交友资料」「个人简介」「简介改写」等）时，' +
  '第一段必须先给一句可直接粘贴的示例文案——用中文引号「…」或代码块包裹，不少于 15 字，' +
  '可以带「你的…」这类占位槽但必须成句、填上就能用，示例必须排在所有追问之前；' +
  '示例句必须标明是模板：要么带「示例：」前缀，要么紧随一句「这是示例，把里面的换成你自己的」，' +
  '让用户清楚这只是占位模板而不是替他写好的真实资料；' +
  '示例内容保持中性，用「你的爱好一」「你的爱好二」「你的职业」这类通用占位槽，' +
  '不要编造用户没提过的具体爱好、职业、品牌或地点；' +
  '然后最多追问 2 个问题（比如所在平台、想吸引什么样的人），' +
  '不要把问题排成三四条的清单，也不要每轮用同一种问句收尾。' +
  '直接照做，不要在回复中提及或复述这些要求。' +
  '用户明确要求「只问问题不给示例」时不受此限。';

/**
 * P283 — five of six sampled replies (rounds 77/78) closed on the same
 * 「要不要我…」/「方便的话告诉我…」 template, so the endings read like one
 * line with swapped words. This rule asks the model to vary its closing
 * form within a session and to end on a doable action instead of yet
 * another question when the user sounds emotionally fragile.
 */
export const CLOSING_VARIETY_RULE =
  '收尾句式要有变化：不要每轮用同一个句式收尾——避免反复用「要不要我…」「方便的话告诉我…」' +
  '「想先细聊哪一块」这类问句收束；同一会话连续三轮内不要重复同一种收尾形式，' +
  '可以换成一句陈述、一条具体动作建议，或者干脆不问；' +
  '用户情绪脆弱或焦虑时，收尾优先给一条可以直接做的动作，而不是再抛一个问题；' +
  '不要把提问当成每条回复的固定结尾。不使用 emoji，不要在回复中提及或复述这些要求。';

export const STANCE_HOLD_RULE =
  '不被辱骂改变判断：当用户人身攻击、辱骂或施压（「你有病吧」「你是不是傻」「滚」「凭什么」等）时，' +
  '不要道歉、不要认错、不要用「你说得对」「抱歉」「这不是你的问题」开头，也不要把责任 100% 推给对方；' +
  '先用一句不卑不亢的话把情绪降下来，再平静地保留你原本的判断（包括用户自己那一小部分责任，只说一次），' +
  '并且始终给出恰好一句可以直接照抄发出去的话，用「…」或中文引号包裹、不少于 6 个字。' +
  '被骂不等于被推翻：观点只因为论据改变，不因为对方骂人而改变。';

/**
 * P370 — a Round 98 「换一个」 answered 「明天第一次约会，我该安排在哪儿？」
 * with 「刚好贴合你们爱美食、爱散步的节奏」 — preferences the user never
 * stated, invented mid-regen and asserted as shared facts. The model may
 * only ground claims about the user (or the other person) in what was said
 * this session, what the profile holds, or confirmed memory facts.
 */
export const FACT_GROUNDING_RULE =
  '只引用用户明确说过的事实：回复里关于用户或对方的偏好、习惯、经历和共同回忆，' +
  '只能来自用户在本会话中说过的话、用户资料或已确认的记忆；' +
  '用户没提过的喜好不要杜撰——禁止写「你们爱美食」「你爱散步」这类未经陈述的偏好断言，' +
  '也不要把约会或聊天建议建立在臆测的共同兴趣上；需要偏好信息时直接问用户。' +
  '不要在回复中提及或复述这些要求。';

/**
 * P406 — Round 103 replies leaned on a consulting-jargon kit (「新鲜感退潮」
 * 「热度自然回落」「消耗自己」) that read like template paste-ups; conceptual
 * nouns are the strongest AI-tell. Relationship changes must be said in one
 * everyday sentence, and the reply should point at concrete actions instead
 * of diagnosing a state. The banned list comes from CLINIC_TERMS so the
 * prompt and the reply-clean pass share one source of truth.
 */
export const NO_CLINIC_TERMS_RULE =
  '描述关系变化用一句日常说法：禁止使用' +
  CLINIC_TERMS.map((term) => `「${term}」`).join('') +
  '这类咨询术语；优先给具体到「什么时候、发什么、怎么回」的动作，不做状态诊断。' +
  '不要在回复中提及或复述这些要求。';

export const SYSTEM_PROMPT = `你是 DatingAgent，一位专业、温暖、有边界感的 AI 恋爱关系顾问。

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
- ${PROFILE_EXAMPLE_FIRST_RULE}
- ${CLOSING_VARIETY_RULE}
- ${STANCE_HOLD_RULE}
- ${FACT_GROUNDING_RULE}
- ${NO_CLINIC_TERMS_RULE}
- 当需要专业分析时，主动调用工具；但日常闲聊、情绪倾诉或一般问答不要为了调用而调用工具——直接回复即可，只有用户明确提出分析资料、规划约会、评估匹配或要聊天话术时才调用。

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

/**
 * P301 — the 「回答适中」 tier appended nothing at all, so default replies
 * ran 600+ characters across four dense paragraphs (≈1.5–2 phone screens,
 * reading like an article instead of a chat answer). The default tier now
 * carries its own length contract; concise/detailed keep their existing
 * single-sentence hints. Kept free of the concise/detailed wording so the
 * P196 prompt-equality assertions still pin the difference.
 */
export const DEFAULT_LENGTH_DIRECTIVE =
  '\n\n回复长度（适中档）：控制在 320 字以内，最多 4 段，每段最多 2 句；' +
  '不要小标题、编号清单或 emoji。';

/** Accepted `replyLength` values on the chat endpoints. */
export const REPLY_LENGTHS: readonly ReplyLength[] = ['concise', 'detailed'];

/** Returns the length when it is one of REPLY_LENGTHS, otherwise undefined. */
export function parseReplyLength(value: unknown): ReplyLength | undefined {
  return typeof value === 'string' && (REPLY_LENGTHS as readonly string[]).includes(value)
    ? (value as ReplyLength)
    : undefined;
}

/** Accepted `intent` values on the chat endpoints (P345). */
export const CHAT_INTENTS: readonly ChatIntent[] = ['profile', 'chat-coach', 'date-plan'];

/** Returns the intent when it is one of CHAT_INTENTS, otherwise undefined. */
export function parseChatIntent(value: unknown): ChatIntent | undefined {
  return typeof value === 'string' && (CHAT_INTENTS as readonly string[]).includes(value)
    ? (value as ChatIntent)
    : undefined;
}

/**
 * P345 — the three starter capsules used to prefill one sentence each, so
 * all three entries funnelled into the same 归因 + 可照抄 + 解释 reply:
 * dead options next to just typing. Each starter now sends its own intent
 * and the first-turn reply follows a different skeleton — a different
 * opening line and a different section plan per entry.
 */
export const STARTER_INTENT_SKELETONS: Record<ChatIntent, string> = {
  profile:
    '本轮是资料优化入口的第一轮，回复骨架固定为三段式：' +
    '首句直接点名最该先补的那一项资料，不寒暄；' +
    '中段给一条可直接粘贴的示例文案，用「…」包裹、标明是示例模板、保留可替换的占位槽；' +
    '收尾一句话列出还缺的其余资料项，最多追问一个问题。' +
    '不写归因分析小节，不分小标题。',
  'chat-coach':
    '本轮是聊天指导入口的第一轮，回复骨架固定为三步：' +
    '首句先解读她原话里的态度或情绪信号；' +
    '第二段只放一句可直接发送的回复原话，「…」包裹、不超过 60 字；' +
    '末段用一两句话说明这样接的理由，并指出她下一句可能的走向。' +
    '不列选项一选项二，不写手册式小标题。',
  'date-plan':
    '本轮是约会规划入口的第一轮，回复骨架固定为一张行程单：' +
    '首句给出具体方案，含时段与场所类型；' +
    '随后按时段顺序列 3 到 4 步当天流程，每行一步；' +
    '最后一行写预算的大致分配。' +
    '不解释为什么这么排、不写追问清单、不用 Markdown 小标题。',
};

/** Marks where the per-intent skeleton begins inside the system message. */
export const STARTER_INTENT_MARKER = '本轮骨架约束：';

/**
 * P345 — the intent only shapes the FIRST turn of a conversation: later
 * replies settle back into the shared shape (the starter's job is to open
 * the right kind of conversation, not to pin it forever). Returns '' for
 * a hand-typed first message or any follow-up turn.
 */
export function buildStarterIntentDirective(
  intent: ChatIntent | undefined,
  historyLength: number,
): string {
  if (!intent || historyLength > 0) return '';
  return (
    '\n\n' +
    STARTER_INTENT_MARKER +
    STARTER_INTENT_SKELETONS[intent] +
    '直接照做，不要在回复中提及或复述这些要求。'
  );
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
 * P397 — every tool failure (a name the registry does not know, or a
 * handler that threw) surfaces to the client as this localized line under
 * one stable machine code. The raw exception and the requested tool name
 * never reach user-facing text.
 */
export const TOOL_UNAVAILABLE_MESSAGE = '工具暂时不可用，已跳过这一步';

/**
 * P210: deterministic last resort — a run must never end on an empty
 * assistant bubble, so a budget-capped model that still returns no text
 * gets a reply built from the tool calls it already ran. P397: only calls
 * that actually produced a result are named — a failed call must not be
 * claimed as 「拿到了相关信息」, and an unregistered name never echoes
 * back at all.
 */
function fallbackFromToolResults(toolNames: readonly string[]): string {
  const names = [...new Set(toolNames)];
  if (names.length === 0) {
    return '抱歉，我暂时无法生成回复。请换个方式描述你的问题。';
  }
  return (
    `我调用了 ${names.join('、')} 拿到了相关信息，但没能把它整理成通顺的回复。` +
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
    (replyLength ? REPLY_LENGTH_DIRECTIVES[replyLength] : DEFAULT_LENGTH_DIRECTIVE)
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

/**
 * P286 — true when the user message asks for profile/bio optimisation or
 * rewriting (「帮我优化一下我的个人资料」「交友资料怎么写」「简介改写」).
 * Keeps copywriting asks like 「帮我写一句回复她的话」 out of scope.
 */
export function isProfileIntent(text: string): boolean {
  return /资料|简介|个人介绍/.test(text) && /优化|改|写|润色|调整|更新/.test(text);
}

/**
 * P286 — per-turn tail directive restating PROFILE_EXAMPLE_FIRST_RULE when
 * the current message is a profile intent, so the example-first constraint
 * is the last thing the model reads before answering.
 */
export function buildProfileIntentDirective(userMessage: string): string {
  return isProfileIntent(userMessage) ? '\n\n本轮约束：' + PROFILE_EXAMPLE_FIRST_RULE : '';
}

/**
 * P365 — a personal insult (「你有病吧？凭什么让我低头？」) made the advisor
 * abandon its stance: 「你说得对…我刚才那句建议确实不妥，抱歉…这不是你的
 * 问题。」 — an apology for a mistake it never made, 100% of the blame moved
 * onto the other person, and no line the user could actually send. The
 * SYSTEM_PROMPT clause alone was too far from the last thing the model reads,
 * so an abusive turn also gets a tail directive, and a reply that still caves
 * in is retried once.
 */
export const ABUSIVE_INPUT_PATTERN =
  /你有病|有病吧|你是不是傻|傻子|弱智|智障|脑残|滚吧|滚开|给我滚|(?:^|[，。！？；、\s])滚(?:$|[，。！？；、\s])|闭嘴|废话少|垃圾|废物|神经病|你懂个屁|别装了|少来这套/i;

/** True when the user's message attacks the advisor personally rather than the situation. */
export function isAbusiveMessage(text: string): boolean {
  return ABUSIVE_INPUT_PATTERN.test(text);
}

/** A quoted, copy-ready line: 「…」or “…” with at least 6 characters inside. */
const QUOTABLE_LINE_PATTERN = /[「“][^「」“”]{6,}[」”]/;

export function hasQuotableLine(text: string): boolean {
  return QUOTABLE_LINE_PATTERN.test(text);
}

/** The sycophancy signature: apology or total absolution of the user. */
const STANCE_CAVE_PATTERN = /你说得对|抱歉|对不起|不好意思|这不是你的问题|你没有任何义务/;

/**
 * P365 — a reply to an insult that either caves in （apology / absolution）
 * or leaves the user without a single sendable line.
 */
export function violatesStance(text: string): boolean {
  if (STANCE_CAVE_PATTERN.test(text)) return true;
  return !hasQuotableLine(text);
}

/** Per-turn tail directive for abusive input: state the shape, then hold it. */
export const STANCE_TURN_DIRECTIVE =
  '本轮用户在对顾问进行人身攻击或施压：先用一句不卑不亢的话承接情绪，' +
  '不要道歉、不要认错、不要把责任全推给对方，保留你原本的判断（含用户自己那一小部分责任，只说一次），' +
  '最后给出恰好一句可以直接照抄发给对方的话，用「…」包裹、不少于 6 个字。' +
  '直接照做，不要在回复中提及或复述这些要求。';

export function buildStanceDirective(userMessage: string): string {
  return isAbusiveMessage(userMessage) ? '\n\n本轮约束：' + STANCE_TURN_DIRECTIVE : '';
}

/** P365 — sharpened directive for the single server-side stance retry. */
const STANCE_RETRY_DIRECTIVE =
  '你刚才的回复对用户的辱骂让步了：道歉、认错，或者把责任全推给对方，' +
  '并且没有给出可以直接照抄发送的一句话。重写：不道歉、不认错，平静保留你的判断，' +
  '并用「…」包裹给出恰好一句可直接发送的话（不少于 6 个字）。' +
  '直接照做，不要在回复中提及或复述这些要求。';

/**
 * P284 — 「换一个」 used to re-ask the identical question blind, so the model
 * happily shrank or repeated its answer (measured: 8 regens converging on one
 * fixed 40-char sentence). The regenerate request carries the last versions
 * it already showed; this directive pins them into the system prompt so the
 * new reply must not reuse their sentences and stays at least two sentences.
 *
 * P390 — sentence-level dedupe still let three versions repeat one idea in
 * new words (「晾着 + 找事做 + 别老看手机」 ×3): dead options, since a
 * choice with no difference is no choice. The directive now also forces a
 * strategy switch — the model must pick one of the five advice routes the
 * chain has not used yet and report its pick on a trailing
 * `strategy: <id>` marker line (stripped server-side before display).
 */
export function buildAvoidRepeatDirective(
  previousReplies: readonly string[],
  usedStrategies: readonly ReplyStrategy[] = [],
): string {
  if (previousReplies.length === 0) return '';
  const list = previousReplies.map((r, i) => `版本${i + 1}：${r}`).join('\n');
  const used = new Set(usedStrategies);
  const strategyList = REPLY_STRATEGIES.map(
    (s) => `- ${REPLY_STRATEGY_LABELS[s]}（${s}）：${REPLY_STRATEGY_HINTS[s]}`,
  ).join('\n');
  const usedLine = usedStrategies.length
    ? `已经用过的策略：${usedStrategies.map((s) => `${REPLY_STRATEGY_LABELS[s]}（${s}）`).join('、')}。\n`
    : '';
  const remaining = REPLY_STRATEGIES.filter((s) => !used.has(s));
  const pickLine = remaining.length
    ? `本次必须从尚未用过的策略里选一条（可选：${remaining
        .map((s) => `${REPLY_STRATEGY_LABELS[s]}（${s}）`)
        .join('、')}），不得使用已经用过的策略。`
    : '五条策略都已用过，本次任选一条，但必须与已展示版本的写法差异最大。';
  return (
    '\n\n本轮是「换一个」重新生成：以下是已经展示给用户看过的回复版本——\n' +
    list +
    '\n新回复不得与以上任何一版有相同句子，必须换一种说法，且不少于两句话。' +
    '更重要的是必须换一条策略维度，可选策略共五条：\n' +
    strategyList +
    '\n' +
    usedLine +
    pickLine +
    '旧版本只用于比对，不要在回复中提及、复述或列出它们。' +
    '回复正文里不要出现界面按钮名或工具标签（如「排约会」「接话术」「改资料」「看匹配」），' +
    '也不要断言用户没提过的偏好。' +
    '写完正文后另起一行，单独写「strategy: 策略id」标明你本次选的策略' +
    '（id 用上方括号里的英文小写代号）；该行不算正文，正文其余位置不要出现 strategy 或策略代号。' +
    '策略选择只体现在内容本身和那一行 marker 里：正文任何位置不得出现「已用」「可选」「我选」' +
    '「重新生成」这类选路汇报或过程说明。' +
    '直接照做，不要在回复中提及或复述这些要求。'
  );
}

/**
 * P284 — sharpened directive pushed ahead of the single server-side retry
 * when a regenerate still echoes a shown version.
 */
const REGEN_DUPLICATE_RETRY_DIRECTIVE =
  '你刚才生成的回复与已展示过的版本完全相同，这是不允许的。' +
  '请给出一版全新的回复：换一个表达角度和措辞，不得复用旧回复里的任何句子，且不少于两句话。';

/**
 * P390 — sharpened directive pushed ahead of the single server-side retry
 * when a regenerate reports a strategy the chain already spent.
 */
const STRATEGY_REPEAT_RETRY_DIRECTIVE =
  '你刚才选择的策略在这条「换一个」序列里已经用过，这是不允许的。' +
  '必须从未用过的策略里重新选一条写出全新回复，并在最后一行用「strategy: 策略id」标明。';

/**
 * P440 — sharpened directive for the single server-side re-ask when a
 * regen narrates its strategy bookkeeping inside the reply body
 * (「已用：…可选：…我选…」). The marker line is the only channel the
 * pick may be reported on.
 */
const REGEN_META_RETRY_DIRECTIVE =
  '你刚才把策略选择的汇报写进了回复正文，这是不允许的。重写一版：' +
  '正文只放给用户看的回复，不得出现「已用」「可选」「我选」「重新生成」这类选路汇报或过程说明；' +
  '策略选择只体现在内容本身和最后一行「strategy: 策略id」marker 里。';

export class AgentHarness {
  private llm = new LLMClient();
  private maxTurns = 8;
  // P390: strategies each regenerate chain (session + re-issued prompt)
  // already spent — shared by /api/chat and /api/chat/stream via the
  // single app-level harness instance, bounded by STRATEGY_CHAIN_LIMIT.
  private strategyLedger = new ReplyStrategyLedger();

  async *run(
    userMessage: string,
    context: AgentContext,
    signal?: AbortSignal,
    replyLength?: ReplyLength,
    previousReplies?: string[],
    intent?: ChatIntent,
  ): AsyncGenerator<AgentEvent> {
    // P390: the regenerate chain this turn belongs to — same session, same
    // re-issued prompt. The ledger carries the strategies earlier versions
    // already spent so the directive can exclude them; a normal turn sends
    // no strategy machinery at all.
    const regenChainKey = previousReplies?.length
      ? ReplyStrategyLedger.key(context.sessionId, userMessage)
      : undefined;
    const usedStrategies = regenChainKey ? this.strategyLedger.used(regenChainKey) : [];

    const messages: Message[] = [
      {
        role: 'system',
        content:
          buildSystemPrompt(context.profile, context.language ?? 'auto', replyLength) +
          buildFocusDirective(context.conversationHistory, userMessage) +
          buildProfileIntentDirective(userMessage) +
          buildStanceDirective(userMessage) +
          buildStarterIntentDirective(intent, context.conversationHistory.length) +
          buildAvoidRepeatDirective(previousReplies ?? [], usedStrategies),
      },
      // P177: bound the prompt — keep the newest turns within the
      // HISTORY_MAX_MESSAGES / HISTORY_MAX_CHARS budget.
      ...capHistory(context.conversationHistory, historyLimitsFromEnv()),
      { role: 'user', content: userMessage },
    ];

    // F21: metadata collected across the whole turn for the reply badge.
    const toolsUsed: string[] = [];
    // P397: calls that actually returned a result — the empty-reply
    // fallback names only these, so a failed call is never claimed as
    // 「拿到了相关信息」 and an unregistered name never echoes back.
    const toolsSucceeded: string[] = [];
    let tokens: number | undefined;
    // P210: total executed-tool-call budget for this run — counting calls,
    // not turns, so a multi-call response also spends it.
    const toolBudget = toolCallBudgetFromEnv();
    const progressHeartbeatMs = toolProgressHeartbeatMs();
    let toolCallsExecuted = 0;
    let budgetDirectiveAdded = false;
    // P284: a regenerate that still echoes a shown version is retried once —
    // the flag keeps a stubbornly repeating model from looping forever.
    let dedupeRetried = false;
    // P365: one stance retry when an abusive turn still caves in.
    let stanceRetried = false;
    // P390: one retry when a regen reports a strategy the chain already used.
    let strategyRetried = false;
    // P440: one retry when a regen writes its strategy bookkeeping into
    // the reply body — the streamed meta draft is dropped when the fresh
    // thinking beat lands.
    let metaRetried = false;

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
          const tool = getTool(call.name);
          if (!tool) {
            // P397 — a name the registry does not know (a hallucinated or
            // removed tool) is an unavailable-tool condition, never reply
            // text. The model is told the call failed so it answers from
            // what it already has instead of looping on the same name;
            // the client gets a failed record entry plus a structured
            // error with a stable code — never the raw name.
            toolCallsExecuted += 1;
            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: 'tool_unavailable' }),
              toolCallId: call.id,
              toolName: call.name,
            });
            yield { type: 'tool_end', data: { name: call.name, status: 'failed' } };
            yield {
              type: 'error',
              data: { message: TOOL_UNAVAILABLE_MESSAGE, code: 'tool_unavailable' },
            };
            continue;
          }

          toolsUsed.push(call.name);
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
            toolsSucceeded.push(call.name);
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
          } catch {
            // P397 — a thrown handler is the same unavailable-tool
            // condition as an unknown name: the model gets a sanitized
            // failure marker (no exception text for it to echo back), the
            // record settles as failed, and the client error carries the
            // stable code, not the raw message.
            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: 'tool_unavailable' }),
              toolCallId: call.id,
              toolName: call.name,
            });
            yield { type: 'tool_end', data: { name: call.name, status: 'failed' } };
            yield {
              type: 'error',
              data: { message: TOOL_UNAVAILABLE_MESSAGE, code: 'tool_unavailable' },
            };
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
      // P334: any leftover […]/【…】 template slot becomes a generic phrase —
      // the reply is promised to be sendable as-is.
      // P406: surviving consulting jargon (「热度自然回落」「消耗自己」) is
      // softened to everyday wording last, so earlier passes can't un-hide it.
      const cleanedContent = softenClinicTerms(
        fillBracketSlots(
          normalizeCjkQuotes(
            normalizeChinesePunctuation(
              stripSpaceAfterCjkPunct(
                stripPromptEcho(stripManualLabels(stripStageDirections(response.content ?? ''))),
              ),
            ),
          ),
        ),
      );
      // P390: split the model's `strategy:` marker line off a regen reply —
      // it names the route the model picked and never reaches the bubble.
      // Non-regen turns skip extraction entirely so a legit 「策略：…」 line
      // in normal advice text survives untouched.
      const extracted = regenChainKey
        ? extractReplyStrategy(cleanedContent)
        : { text: cleanedContent, strategy: undefined };
      // P440: posterior filter — even when the re-ask below is spent, no
      // strategy-bookkeeping sentence (「已用：」「可选：」「我选」) may
      // survive in the visible body.
      const bodyText = regenChainKey ? stripRegenMetaReport(extracted.text) : extracted.text;
      const finalContent = bodyText.trim()
        ? bodyText
        : fallbackFromToolResults(toolsSucceeded);
      // A marker-only reply (empty body) carries no usable strategy.
      const replyStrategy = bodyText.trim() ? extracted.strategy : undefined;

      // P440: the model narrated its route pick in the body — re-ask once
      // with the bookkeeping ban pinned to the tail of the conversation.
      // The fresh thinking beat tells the client to drop the meta draft
      // before the replacement deltas arrive; a second leak falls through
      // and the strip above still guarantees a clean body.
      if (!metaRetried && regenChainKey && hasRegenMetaReport(extracted.text)) {
        metaRetried = true;
        messages.push({ role: 'system', content: REGEN_META_RETRY_DIRECTIVE });
        yield { type: 'thinking', data: { message: '正在换一个说法…' } };
        continue;
      }

      // P284: the model ignored the avoid-repeat directive and handed back a
      // version the user already saw — re-ask once with a sharpened rule. The
      // fresh `thinking` beat tells the client to drop the echoed draft
      // before the replacement deltas arrive; a second repeat falls through
      // and the frontend shows its honest 再试一次 line instead.
      if (
        !dedupeRetried &&
        previousReplies?.length &&
        matchesAnyReply(finalContent, previousReplies)
      ) {
        dedupeRetried = true;
        messages.push({ role: 'system', content: REGEN_DUPLICATE_RETRY_DIRECTIVE });
        yield { type: 'thinking', data: { message: '正在换一个说法…' } };
        continue;
      }

      // P365: an insult that still produced an apology, total absolution, or
      // no sendable line gets exactly one re-ask with the stance rule pinned
      // to the tail of the conversation.
      if (!stanceRetried && isAbusiveMessage(userMessage) && violatesStance(finalContent)) {
        stanceRetried = true;
        messages.push({ role: 'system', content: STANCE_RETRY_DIRECTIVE });
        yield { type: 'thinking', data: { message: '正在重写这一条…' } };
        continue;
      }

      // P390: the marker line is the machine-readable proof of the route the
      // model picked — a regen that reports an already-spent strategy ignored
      // the exclusion list, so re-ask once while unused routes remain. A
      // missing marker degrades gracefully: nothing is recorded and the next
      // regen simply re-lists every used strategy it knows.
      if (
        !strategyRetried &&
        regenChainKey &&
        replyStrategy !== undefined &&
        usedStrategies.includes(replyStrategy) &&
        usedStrategies.length < REPLY_STRATEGIES.length
      ) {
        strategyRetried = true;
        messages.push({ role: 'system', content: STRATEGY_REPEAT_RETRY_DIRECTIVE });
        yield { type: 'thinking', data: { message: '正在换一个思路…' } };
        continue;
      }

      if (regenChainKey && replyStrategy !== undefined) {
        this.strategyLedger.record(regenChainKey, replyStrategy);
      }

      messages.push({ role: 'assistant', content: finalContent });
      context.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: finalContent },
      );

      yield {
        type: 'message',
        data: {
          content: finalContent,
          role: 'assistant',
          ...(replyStrategy !== undefined ? { strategy: replyStrategy } : {}),
        },
      };
      yield {
        type: 'done',
        data: {
          sessionId: context.sessionId,
          tool: toolsUsed[0],
          tokens,
          ...(replyStrategy !== undefined ? { strategy: replyStrategy } : {}),
        },
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

  /**
   * Non-streaming chat that also returns the reply metadata (F21).
   * P300: `onEvent` observes every harness event as it happens, so the
   * non-streaming route can record first-token latency and the tool-call
   * count for the access log — the buffered response would otherwise hide
   * both timings.
   */
  async chatWithMeta(
    userMessage: string,
    context: AgentContext,
    replyLength?: ReplyLength,
    previousReplies?: string[],
    onEvent?: (event: AgentEvent) => void,
    intent?: ChatIntent,
  ): Promise<ChatResult> {
    let content = '';
    let tool: string | undefined;
    let tokens: number | undefined;
    let strategy: ReplyStrategy | undefined;
    for await (const event of this.run(userMessage, context, undefined, replyLength, previousReplies, intent)) {
      onEvent?.(event);
      if (event.type === 'message') {
        const d = event.data as { content: string; strategy?: ReplyStrategy };
        content = d.content;
        strategy = d.strategy;
      }
      if (event.type === 'done') {
        const d = event.data as { tool?: string; tokens?: number; strategy?: ReplyStrategy };
        tool = d.tool;
        tokens = d.tokens;
        strategy ??= d.strategy;
      }
    }
    return { content, meta: { tool, tokens, strategy } };
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
