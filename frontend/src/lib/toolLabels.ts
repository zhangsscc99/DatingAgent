/**
 * P239 — single source of truth for tool id → Chinese display name. The
 * streaming badges (App.tsx) and the finished reply's meta line
 * (MessageBubble.tsx) both read this map so an internal id like
 * `coach_conversation` can never leak into bubble copy: callers render
 * `toolDisplayName(id)`, and an unmapped id renders nothing at all.
 */
export const TOOL_LABELS: Record<string, string> = {
  analyze_profile: '资料优化',
  coach_conversation: '聊天指导',
  plan_date: '约会规划',
  check_compatibility: '匹配分析',
  get_relationship_advice: '关系建议',
};

/** Chinese name for a known tool id, `undefined` for anything unmapped. */
export function toolDisplayName(id: string): string | undefined {
  return TOOL_LABELS[id];
}
