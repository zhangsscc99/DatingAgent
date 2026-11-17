/**
 * P249 — header status-row copy. The row used to read 「LLM 已连接」/「Demo 模式」:
 * a vendor term aimed at a dating-advice user, plus a label that made the
 * product sound like a crippled build. The visible text is now plain product
 * language; model availability stays in the title/aria detail for anyone who
 * needs the technical answer. Pure, no React.
 */

export interface HeaderStatusCopy {
  /** Visible label beside the status dot — product language only. */
  label: string;
  /** Technical detail for `title`/`aria-label`; never rendered as body text. */
  detail: string;
}

/** Copy pair for the header status row, keyed off health.llmConfigured. */
export function headerStatusCopy(llmConfigured: boolean): HeaderStatusCopy {
  return llmConfigured
    ? { label: '顾问在线', detail: 'AI 模型已连接，回复由顾问实时生成' }
    : { label: '体验模式', detail: '未配置 AI 模型，当前展示本地示例回复' };
}
