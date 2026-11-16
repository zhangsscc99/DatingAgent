import type { StoredChatSession } from './chatStorage';
import { filterRecentSessions } from './sessionFilter';

/**
 * P164: Sidebar keeps filterQuery/editingId as local state, so they must be
 * reconciled whenever the stored session list changes — a row delete, 清空全部,
 * or the P156 cross-tab sync replacing recentSessions wholesale.
 */

/**
 * Keep a typed query only while it still matches at least one stored session
 * under the same rule the filter box applies; once nothing matches (the last
 * hit was deleted, or the list was cleared) return '' so the section doesn't
 * sit on 无匹配对话 while conversations exist again.
 */
export function nextFilterQueryAfterSessionsChange(
  prevQuery: string,
  sessions: StoredChatSession[],
): string {
  return filterRecentSessions(sessions, prevQuery).length > 0 ? prevQuery : '';
}

/**
 * P187: the filter empty-state hint is only meaningful when stored sessions
 * exist but the current query emptied the visible list — a genuinely empty
 * history must not claim a filter is hiding anything.
 */
export function shouldShowFilterEmptyHint(
  totalSessions: number,
  visibleSessions: number,
): boolean {
  return totalSessions > 0 && visibleSessions === 0;
}

/**
 * P188: the eviction notice is only meaningful while stored sessions still
 * exist — with an empty history it would point at conversations that are
 * already gone. Pure: takes the module-state notice plus the list length so
 * the render gate can be tested without mounting the sidebar.
 */
export function shouldShowEvictionNotice(
  notice: string | null,
  sessionCount: number,
): boolean {
  return notice !== null && sessionCount > 0;
}

/**
 * Keep an in-progress rename only while its row still exists. A vanished row
 * (deleted in this tab or removed by a cross-tab sync) drops the id so a stale
 * editingValue can never commit onto a wrong or absent row.
 */
export function nextEditingIdAfterSessionsChange(
  editingId: string | null,
  sessions: StoredChatSession[],
): string | null {
  if (editingId === null) return null;
  return sessions.some((s) => s.id === editingId) ? editingId : null;
}
