/**
 * P239 — single source of truth for tool id → Chinese display name. The
 * streaming badges (App.tsx) and the finished reply's meta line
 * (MessageBubble.tsx) both read this map so an internal id like
 * `coach_conversation` can never leak into bubble copy: callers render
 * `toolDisplayName(id)`, and an unmapped id renders nothing at all.
 *
 * P285 — the values are user-facing noun phrases (same vocabulary as the
 * 「进阶工具」 sidebar section), not the internal module names.
 */
export const TOOL_LABELS: Record<string, string> = {
  analyze_profile: '改资料',
  coach_conversation: '接话术',
  plan_date: '排约会',
  check_compatibility: '看匹配',
  get_relationship_advice: '关系建议',
};

/** Chinese name for a known tool id, `undefined` for anything unmapped. */
export function toolDisplayName(id: string): string | undefined {
  return TOOL_LABELS[id];
}
