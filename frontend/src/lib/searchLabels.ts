/**
 * P271 — the header's in-conversation find entry and the sidebar session
 * filter both read like "search my history" (搜索对话 / 搜索当前对话 vs
 * 筛选对话), so a user hunting for an old conversation kept clicking the
 * wrong one. The find entry now says 在本对话内查找 everywhere and the
 * sidebar keeps 筛选对话, plus a muted scope line under its empty state
 * that says both titles and message bodies are searched. Both string sets live here so
 * components and tests reference one source of truth.
 */

/** Accessible name and tooltip of the header find trigger + find input. */
export const FIND_IN_CONVERSATION_LABEL = '在本对话内查找';

/** Placeholder of the find input inside the open conversation. */
export const FIND_IN_CONVERSATION_PLACEHOLDER = '在本对话内查找…';

/** Prev-match button in the find bar. */
export const FIND_IN_CONVERSATION_PREV_LABEL = '上一个匹配';

/** Next-match button in the find bar. */
export const FIND_IN_CONVERSATION_NEXT_LABEL = '下一个匹配';

/** Close button of the find bar. */
export const FIND_IN_CONVERSATION_CLOSE_LABEL = '关闭查找';

/** Accessible name and placeholder of the sidebar session filter input. */
export const FILTER_SESSIONS_LABEL = '筛选对话';

/** Muted scope line under the filter empty state: the filter matches both
 * session titles and message bodies (filterRecentSessions → matchSessionMessage). */
export const FILTER_SESSIONS_HINT = '标题和对话内容都搜';
