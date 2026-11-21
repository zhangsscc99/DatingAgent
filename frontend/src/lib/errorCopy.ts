/**
 * P87 — every user-visible chat error goes through this one map. The
 * backend's raw `message` is often an internal English exception
 * (`LLM request failed: 401 …`) and SSE error events also carry a stable
 * machine `code` — neither may reach the bubble. Resolution order: the
 * machine `code` first, then the HTTP `status`, then a generic Chinese
 * fallback. The raw detail is kept in `console.warn` for debugging —
 * never in the returned copy, which must stay free of English sentences,
 * internal identifiers and bare `HTTP 4xx/5xx` strings. Pure.
 */
export interface ChatErrorDetail {
  /** Stable machine code from the SSE/JSON error payload, e.g. `tool_unavailable`. */
  code?: string;
  /** Raw error detail — logged for debugging, never echoed to the user. */
  message?: string;
  /** HTTP status; 0 or absent means a transport-level failure. */
  status?: number;
  /** Parsed Retry-After seconds accompanying a 429. */
  retryAfterSec?: number;
}

export function humanizeChatError(input: ChatErrorDetail): string {
  const { code, message, status, retryAfterSec } = input;
  if (code || message || typeof status === 'number') {
    console.warn('[chat-error]', { code, status, message });
  }
  if (code === 'tool_unavailable') return '这个功能暂时用不了，换个问法再试';
  if (typeof status === 'number' && status > 0) {
    if (status === 429) {
      return retryAfterSec && retryAfterSec > 0
        ? `问得太快了，请 ${retryAfterSec} 秒后再试`
        : '问得太快了，稍等一下再试';
    }
    if (status === 413) return '消息太长了，请精简到 4000 字以内再发送';
    if (status === 401 || status === 403) return '登录状态好像失效了，刷新页面再试';
    if (status >= 500) return '服务暂时忙不过来，稍等再试';
    return '出了点小问题，换个说法再试一次';
  }
  if (status === 0) return '网络好像断了，检查一下再试';
  return '出了点小问题，换个说法再试一次';
}
