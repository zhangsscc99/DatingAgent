/**
 * P316 — the 进阶工具 sidebar entries drop a ready-to-edit starter question
 * into the composer (prefill only; the user still presses send). Keyed by
 * tool id so a live /api/tools row and the TOOL_FALLBACK list land on the
 * same text. Single copy source — the sidebar-tool-entries test asserts
 * against this map.
 */
export const TOOL_PROMPTS: Record<string, string> = {
  analyze_profile: '我把交友资料贴给你，帮我改得更有吸引力',
  coach_conversation: '对方发来一句话我不知道怎么接，帮我看看怎么回',
  plan_date: '帮我安排一次约会，把时间和流程排清楚',
  check_compatibility: '帮我看看我们俩合不合适',
  get_relationship_advice: '最近相处有点拿不准，给我一些关系上的建议',
};

/** Starter question for a 进阶工具 entry, or null when the tool id has no
 * mapped intent — the caller skips that row instead of leaving a dead one. */
export function toolPromptFor(toolName: string): string | null {
  return TOOL_PROMPTS[toolName] ?? null;
}
