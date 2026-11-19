import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  clearLastEvictionNotice,
  getLastEvictionNotice,
} from '../lib/chatStorage';
import type { StoredChatSession } from '../lib/chatStorage';
import { CLEAR_ALL_LABEL, CLEAR_ALL_TRASH_TITLE } from '../lib/copy';
import { shouldHandleEscape, shouldSubmitOnEnter } from '../lib/ime';
import { formatRelativeTime, isRenderableTimestamp } from '../lib/relativeTime';
import { highlightSegments } from '../lib/messageSearch';
import { filterRecentSessions, matchSessionMessage } from '../lib/sessionFilter';
import {
  filterRecentChats,
  recentChatEmptyState,
} from '../lib/recentChatFilter';
import { searchSnippet } from '../lib/searchSnippet';
import { FILTER_SESSIONS_HINT, FILTER_SESSIONS_LABEL } from '../lib/searchLabels';
import { nextSessionIndex, sessionNavDirection } from '../lib/sessionListNav';
import {
  nextEditingIdAfterSessionsChange,
  nextFilterQueryAfterSessionsChange,
  shouldShowClearAll,
  shouldShowEvictionNotice,
  shouldShowFilterEmptyHint,
  shouldShowTrashEntry,
} from '../lib/sidebarListState';
import type { TrashEntry } from '../lib/chatTrash';
import TrashSheet from './TrashSheet';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { toolDisplayName } from '../lib/toolLabels';
import { toolPromptFor } from '../lib/toolPrompts';
import { STARTER_ENTRIES } from '../lib/starterEntries';
import type { StarterIconKey } from '../lib/starterEntries';
import type { ToolInfo, UserProfile } from '../types';
import './Sidebar.css';

// P164 moved the matcher to lib/sessionFilter.ts; re-exported so existing
// consumers and tests keep importing it from here.
export { filterRecentSessions };

interface Props {
  tools: ToolInfo[];
  profile?: UserProfile | null;
  recentSessions?: StoredChatSession[];
  activeSessionId?: string | null;
  open?: boolean;
  isMobile?: boolean;
  /** P281: desktop-only collapse — the aside zeroes its width and goes inert;
   * ignored below the mobile breakpoint (the drawer owns open/close there). */
  collapsed?: boolean;
  onClose?: () => void;
  onQuickPrompt: (prompt: string) => void;
  onNewChat: () => void;
  onSelectChat?: (sessionId: string) => void;
  onDeleteChat?: (sessionId: string) => void;
  onRenameChat?: (sessionId: string, title: string) => void;
  onClearAllChats?: () => void;
  onEditProfile?: () => void;
  onOpenSettings?: () => void;
  /** P265: the recycle bin — App owns the entries and the restore/clear
   * handlers so a restore refreshes the session list too. */
  trashEntries?: TrashEntry[];
  onRestoreTrash?: (sessionId: string) => void;
  onClearTrash?: () => void;
  busy?: boolean;
  /** P320: the pristine first screen (no stored conversations AND no
   * messages) demotes「+ 新对话」to a quiet outlined button — the composer's
   * send key is the only solid brand action until a conversation exists. */
  pristine?: boolean;
  /** P322: true while the /api/tools request is still in flight — the tool
   * list then renders five disabled aria-busy skeleton rows (real labels at
   * the real row height) instead of a short/blank list. Once the fetch
   * settles this goes false and the real buttons — or the TOOL_FALLBACK
   * entries on failure — swap in with zero layout shift. */
  toolsLoading?: boolean;
}

/** Label the persisted message count on a session row. Pure: treats
 * undefined/null/non-array input as 0, never throws, never mutates.
 * P377: the in-card chip carries the same 条消息 unit the filter count
 * line announces — no bare 条 next to a 段对话 heading. */
export function formatMessageCount(messages: unknown): string {
  const n = Array.isArray(messages) ? messages.length : 0;
  return `${n} 条消息`;
}

export type SessionDayGroupLabel = '今天' | '昨天' | '更早';

export interface SessionDayGroup {
  label: SessionDayGroupLabel;
  sessions: StoredChatSession[];
}

const DAY_GROUP_ORDER: SessionDayGroupLabel[] = ['今天', '昨天', '更早'];

function localDayStart(timestamp: number): number {
  const d = new Date(timestamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Bucket an already-filtered session list by local calendar day. Pure:
 * preserves incoming row order inside each bucket, omits empty groups, and
 * never mutates the input. Invalid/missing/far-future updatedAt lands in 更早. */
export function groupSessionsByDay(
  sessions: StoredChatSession[],
  now: number = Date.now(),
): SessionDayGroup[] {
  const nowDate = new Date(now);
  const todayStart = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  const yesterdayStart = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate() - 1,
  ).getTime();

  const buckets: Record<SessionDayGroupLabel, StoredChatSession[]> = {
    今天: [],
    昨天: [],
    更早: [],
  };
  for (const s of sessions) {
    // P186: corrupt timestamps (non-number/non-finite/<=0/far-future) must not
    // form a real day bucket — NaN dayStart falls through to 更早 below.
    const dayStart = isRenderableTimestamp(s.updatedAt, now)
      ? localDayStart(s.updatedAt)
      : Number.NaN;
    const label: SessionDayGroupLabel =
      dayStart >= todayStart
        ? '今天'
        : dayStart === yesterdayStart
          ? '昨天'
          : '更早';
    buckets[label].push(s);
  }
  return DAY_GROUP_ORDER.filter((label) => buckets[label].length > 0).map(
    (label) => ({ label, sessions: buckets[label] }),
  );
}

// P199: restrained inline SVGs (currentColor stroke) replace the emoji glyphs;
// the text label still carries the meaning, so every icon is aria-hidden.
// P358: the key space widens past the four starter keys — the 进阶工具 rows
// mount the same icon + label + chevron anatomy as the 快捷入口 cards, so
// tool ids resolve onto this one icon set through TOOL_ICON_KEYS below.
// P378: 'trash' marks the two destructive/restore destinations (清空全部
// button + 回收站 row); 'search' is the inset filter field's left glyph.
type SidebarIconKey = StarterIconKey | 'advice' | 'trash' | 'search';

const QUICK_ICON_PATHS: Record<SidebarIconKey, string[]> = {
  profile: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  calendar: [
    'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
    'M16 2v4',
    'M8 2v4',
    'M3 10h18',
  ],
  heart: [
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  ],
  advice: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
  ],
  trash: [
    'M3 6h18',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M10 11v6',
    'M14 11v6',
  ],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
};

function SidebarIcon({
  iconKey,
  size = 15,
  className = '',
}: {
  iconKey: SidebarIconKey;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`sidebar-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {QUICK_ICON_PATHS[iconKey].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// P358: the shared right-edge affordance. Both entry groups render the same
// icon + label + chevron row anatomy, so this chevron is one component —
// aria-hidden like the icons (the button's aria-label carries the name).
function SidebarChevron() {
  return (
    <svg
      className="sidebar-chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// P358 — the 进阶工具 rows carry the same leading-icon anatomy as the
// 快捷入口 cards above them; each tool id maps onto the shared icon set and
// an unmapped id falls back to the advice compass rather than rendering a
// bare row.
const TOOL_ICON_KEYS: Record<string, SidebarIconKey> = {
  analyze_profile: 'profile',
  coach_conversation: 'chat',
  plan_date: 'calendar',
  check_compatibility: 'heart',
  get_relationship_advice: 'advice',
};

const toolIconKey = (name: string): SidebarIconKey =>
  TOOL_ICON_KEYS[name] ?? 'advice';

// P355: the 快捷入口 rows render STARTER_ENTRIES from lib/starterEntries.ts —
// the one array the first screen shares, so the drawer and the welcome block
// can never hold two different entry lists again.

// P220: when /api/tools has not loaded yet, the 工具 list falls back to the
// real capability names — never to the quick-prompt labels, which would
// render the same text twice in the drawer. Exported: the one source of
// truth for the five tool labels — P322's skeleton rows and the tests both
// read this list instead of re-hardcoding names.
export const TOOL_FALLBACK: ToolInfo[] = [
  { name: 'analyze_profile', label: '改资料', icon: '' },
  { name: 'coach_conversation', label: '接话术', icon: '' },
  { name: 'plan_date', label: '排约会', icon: '' },
  { name: 'check_compatibility', label: '看匹配', icon: '' },
  { name: 'get_relationship_advice', label: '关系建议', icon: '' },
];

export default function Sidebar({
  tools,
  profile,
  recentSessions = [],
  activeSessionId,
  open = false,
  isMobile = false,
  collapsed = false,
  onClose,
  onQuickPrompt,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
  onEditProfile,
  onOpenSettings,
  trashEntries = [],
  onRestoreTrash,
  onClearTrash,
  busy = false,
  pristine = false,
  toolsLoading = false,
}: Props) {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const sessionListRef = useRef<HTMLUListElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  // P185: the eviction notice lives in chatStorage's module state — it is set
  // inside saveChatSession, which always precedes a recentSessions refresh, so
  // reading it during render stays in sync. The close button clears the module
  // state; the tick just forces the re-render that then reads null.
  const evictionNotice = getLastEvictionNotice();
  const [, setEvictionTick] = useState(0);
  // P265: open state for the 回收站 sheet anchored under 最近对话.
  const [trashOpen, setTrashOpen] = useState(false);
  // P342: ≥769px is the desktop breakpoint (same query as --column-max and
  // the P281 collapse) — the no-profile 「完善资料」 card stays out of the
  // persistent aside so the welcome footnote link is the one entry.
  const wideViewport = useMediaQuery('(min-width: 769px)');
  const visibleSessions = filterRecentChats(recentSessions, filterQuery);
  const sessionGroups = groupSessionsByDay(visibleSessions);
  const trimmedQuery = filterQuery.trim().toLowerCase();

  // P319: the keyword a row matched on is wrapped in a real <mark> — in the
  // title for title hits, in the P230 excerpt for body-only hits — so the
  // rendered range covers exactly what filterRecentSessions searched.
  const highlightHit = (text: string) =>
    !trimmedQuery
      ? text
      : highlightSegments(text, filterQuery).map((segment, i) =>
          segment.hit ? (
            <mark key={i}>{segment.text}</mark>
          ) : (
            <Fragment key={i}>{segment.text}</Fragment>
          ),
        );

  // P164: reconcile local filter/rename state whenever the stored session
  // list changes (row delete, 清空全部, or the P156 cross-tab sync swapping the
  // array). The effect keys on an id:title signature, so an identical
  // replacement array — or any unrelated render — never refires it, a query
  // that still matches is kept, and a rename whose row survives is untouched.
  const sessionsKey = useMemo(
    () =>
      `${recentSessions.length}|` +
      recentSessions.map((s) => `${s.id}:${s.title ?? ''}`).join('|'),
    [recentSessions],
  );
  useEffect(() => {
    setFilterQuery((q) => nextFilterQueryAfterSessionsChange(q, recentSessions));
    if (
      nextEditingIdAfterSessionsChange(editingId, recentSessions) !== editingId
    ) {
      setEditingId(null);
      setEditingValue('');
    }
    // recentSessions/editingId are read from the same render that produced
    // this signature — exactly the state being reconciled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsKey]);

  useEffect(() => {
    if (!editingId) return;
    const el = editInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (isMobile && open) {
      closeBtnRef.current?.focus();
    }
  }, [isMobile, open]);

  // P265: a closed mobile drawer goes inert — an open trash sheet anchored
  // inside it would become unreachable, so it folds away with the drawer.
  useEffect(() => {
    if (isMobile && !open) setTrashOpen(false);
  }, [isMobile, open]);

  useEffect(() => {
    if (!isMobile || !open) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const focusable = sidebar.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusable.length === 0) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    sidebar.addEventListener('keydown', trapFocus);
    return () => sidebar.removeEventListener('keydown', trapFocus);
  }, [isMobile, open]);

  // P132: ArrowUp/ArrowDown between .recent-chat-item buttons in the
  // currently rendered (filtered, day-grouped) order; clamps at the ends.
  const handleSessionItemKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const direction = sessionNavDirection(e.key);
    if (direction === null) return;
    const items = sessionListRef.current?.querySelectorAll<HTMLElement>(
      '.recent-chat-item',
    );
    if (!items || items.length === 0) return;
    const current = Array.prototype.indexOf.call(items, e.currentTarget);
    const next = nextSessionIndex(current, items.length, direction);
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <aside
      ref={sidebarRef}
      id="app-sidebar"
      className={`sidebar${isMobile ? ' sidebar-drawer' : ''}${isMobile && open ? ' open' : ''}${!isMobile && collapsed ? ' sidebar-collapsed' : ''}`}
      aria-label="导航侧边栏"
      aria-hidden={isMobile ? !open : undefined}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? open : undefined}
      inert={isMobile ? (!open ? true : undefined) : collapsed ? true : undefined}
    >
      {isMobile && (
        <div className="sidebar-drawer-header">
          <span className="sidebar-drawer-title">菜单</span>
          <button
            ref={closeBtnRef}
            type="button"
            className="sidebar-close-btn"
            aria-label="关闭菜单"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      )}

      {/* P298: everything between the pinned chrome (drawer header above,
          设置 footer below) lives in one scroll region — it shrinks below its
          content height and scrolls internally, so the <aside> itself never
          overflows and the footer never scrolls away with the list. */}
      <div className="sidebar-body">
        {/* P320: on the pristine first screen this is a secondary outline,
            not a solid brand button — two pink solids used to compete with
            the composer's single primary CTA (same demotion P290 gave
            .welcome-cta). The brand fill returns with the first session. */}
        <button
          className={`new-chat-btn${pristine ? ' secondary' : ''}`}
          data-control="row"
          onClick={onNewChat}
          aria-label="开始新对话"
        >
          + 新对话
        </button>

        <section className="sidebar-section recent-chats" aria-label="最近对话">
          <div className="recent-chats-header">
            <h3>最近对话</h3>
            {/* P270: with an empty history the button would open a「清空 0 段
                对话」no-op confirm — hide it until a session exists again. */}
            {shouldShowClearAll(recentSessions) && (
              <button
                type="button"
                className="recent-chat-clear-all"
                // P228: App owns the in-app confirm dialog; this only asks.
                onClick={() => onClearAllChats?.()}
                disabled={busy}
                aria-label={CLEAR_ALL_LABEL}
                // P378: the tooltip names the destination — cleared
                // conversations land in the 回收站 like a single delete.
                title={CLEAR_ALL_TRASH_TITLE}
              >
                <SidebarIcon iconKey="trash" size={12} />
                {CLEAR_ALL_LABEL}
              </button>
            )}
          </div>
          {/* P312: an empty list has nothing to filter — the box mounts
              again with the first conversation. */}
          {recentSessions.length > 0 && (
          <div className="recent-chat-filter-wrap">
          {/* P378: inset search field — the magnifier sits inside the row so
              the control reads as a search without a浅灰圆角条 frame. */}
          <SidebarIcon
            iconKey="search"
            size={14}
            className="recent-chat-filter-icon"
          />
          <input
            ref={filterInputRef}
            type="text"
            className="recent-chat-filter"
            value={filterQuery}
            placeholder={FILTER_SESSIONS_LABEL}
            aria-label={FILTER_SESSIONS_LABEL}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              // P167: a composing Escape cancels the IME, not the filter.
              if (shouldHandleEscape(e)) {
                setFilterQuery('');
                e.currentTarget.blur();
                return;
              }
              // P132: ArrowDown from the filter moves into the first row.
              if (e.key === 'ArrowDown') {
                const first =
                  sessionListRef.current?.querySelector<HTMLElement>(
                    '.recent-chat-item',
                  );
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          {/* P377: one-tap clear while the box holds a query — the old UI
              only offered 清除筛选 inside the zero-match empty state, so a
              query with hits could never be cleared without backspacing.
              Clicking restores the full list and hands focus back to the
              input; the ≥32px target sits inside the right edge, padded
              clear of the typed text. */}
          {filterQuery !== '' && (
            <button
              type="button"
              className="recent-chat-filter-clear"
              aria-label="清除筛选"
              title="清除筛选"
              onClick={() => {
                setFilterQuery('');
                filterInputRef.current?.focus();
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
          </div>
          )}
          {/* P230: announce how many conversations the filter matched, at
              most once per query change; blank while the box is empty so
              mounting the section never announces a count. P245: a zero-match
              query is already announced by the filter-empty-hint li's own
              aria-live, so this region stays silent there instead of doubling
              the empty-state copy with a second generic message. P319: the
              count is also a visible plain-text status line — it used to be
              sr-only, i.e. zero visual weight. P333: render it above the
              result list so the count is read before the hits, not after. */}
          <span className="recent-chat-filter-count" role="status" aria-live="polite">
            {filterQuery.trim() && visibleSessions.length > 0
              ? `找到 ${visibleSessions.length} 段对话 · ${visibleSessions.reduce((n, s) => n + (Array.isArray(s.messages) ? s.messages.length : 0), 0)} 条消息`
              : ''}
          </span>
          {/* P247: a cleared/fresh history used to vanish the whole section —
              keep the heading and fill the list slot with one dim line instead
              of blank space. */}
          {recentSessions.length === 0 && (
            <p className="recent-chat-empty" role="status">
              还没有对话，问第一个问题吧
            </p>
          )}
          {recentSessions.length > 0 && (
            <ul className="recent-chat-list" ref={sessionListRef}>
              {shouldShowFilterEmptyHint(
                recentSessions.length,
                visibleSessions.length,
              ) &&
              recentChatEmptyState(filterQuery, visibleSessions.length) && (
                <li
                  className="recent-chat-empty filter-empty-hint"
                  data-testid="recent-chat-empty"
                  aria-live="polite"
                  aria-label="无匹配对话"
                >
                  <span className="filter-empty-hint-text">
                    没有一段对话匹配「{filterQuery.trim()}」
                  </span>
                  {/* P271/P275: the filter only matches recent titles — fold the
                      scope note into the empty state's first sentence so it is
                      read before the 清除筛选 action, not after it. */}
                  <span className="filter-empty-hint-scope">
                    {FILTER_SESSIONS_HINT}
                  </span>
                  <button
                    type="button"
                    className="filter-empty-clear"
                    aria-label="清除筛选"
                    title="清除筛选"
                    onClick={() => setFilterQuery('')}
                  >
                    清除筛选
                  </button>
                </li>
              )}
              {sessionGroups.map((group) => (
                <Fragment key={group.label}>
                  <li className="recent-chat-group">{group.label}</li>
                  {group.sessions.map((s) => {
                    // P230: a session the query kept only through its message
                    // body shows why — one dim excerpt line under the title.
                    // Title hits and empty queries add nothing, so rows never
                    // shift when the box is blank.
                    const bodyMatch =
                      trimmedQuery &&
                      !s.title.toLowerCase().includes(trimmedQuery)
                        ? matchSessionMessage(s, filterQuery)
                        : null;
                    // P354: a title hit renders the ±12-char window centred
                    // on the match — the full title used to keep CSS
                    // ellipsis free to swallow the <mark> in its tail.
                    const titleSnippet = trimmedQuery
                      ? searchSnippet(s.title, filterQuery)
                      : null;
                    const commitRename = () => {
                      // Enter already exits edit mode; ignore the blur that follows.
                      if (editingId !== s.id) return;
                      const next = editingValue.trim();
                      if (next && next !== s.title) onRenameChat?.(s.id, next);
                      setEditingId(null);
                    };
                    return (
                      <li key={s.id} className="recent-chat-row">
                        {editingId === s.id ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            className="recent-chat-rename-input"
                            value={editingValue}
                            maxLength={40}
                            disabled={busy}
                            aria-label={`重命名对话：${s.title}`}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              // P167: while composing, Enter/Escape belong to
                              // the IME — never commit or cancel mid-conversion.
                              if (shouldSubmitOnEnter(e)) commitRename();
                              if (shouldHandleEscape(e)) setEditingId(null);
                            }}
                            onBlur={commitRename}
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`recent-chat-item${s.id === activeSessionId ? ' active' : ''}`}
                              data-control="row"
                              onClick={() => onSelectChat?.(s.id)}
                              onKeyDown={handleSessionItemKeyDown}
                              disabled={busy}
                              aria-disabled={busy || undefined}
                              title={s.title}
                              aria-current={s.id === activeSessionId ? 'true' : undefined}
                            >
                              <span
                                className={`recent-chat-title${titleSnippet ? ' has-hit' : ''}`}
                              >
                                {highlightHit(
                                  titleSnippet
                                    ? titleSnippet.before +
                                        titleSnippet.match +
                                        titleSnippet.after
                                    : s.title,
                                )}
                              </span>
                              {bodyMatch && (
                                <span className="recent-chat-excerpt has-hit">
                                  {highlightHit(bodyMatch.excerpt)}
                                </span>
                              )}
                              <span className="recent-chat-meta">
                                <span className="recent-chat-time">{formatRelativeTime(s.updatedAt)}</span>
                                <span
                                  className="recent-chat-count"
                                  title={`共 ${Array.isArray(s.messages) ? s.messages.length : 0} 条消息`}
                                >
                                  {formatMessageCount(s.messages)}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="recent-chat-rename"
                              onClick={() => {
                                setEditingId(s.id);
                                setEditingValue(s.title);
                              }}
                              disabled={busy}
                              aria-disabled={busy || undefined}
                              aria-label={`重命名对话：${s.title}`}
                              title={`重命名对话：${s.title}`}
                            >
                              <SidebarIcon iconKey="profile" />
                            </button>
                            <button
                              type="button"
                              className="recent-chat-delete"
                              onClick={() => onDeleteChat?.(s.id)}
                              disabled={busy}
                              aria-disabled={busy || undefined}
                              aria-label={`删除对话：${s.title}`}
                              title={`删除对话：${s.title}`}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </Fragment>
              ))}
            </ul>
          )}
          {/* P265: the way back from a delete — visible whenever either list
              holds something, above the eviction notice; a totally empty
              section hides the row entirely. */}
          {shouldShowTrashEntry(recentSessions.length, trashEntries.length) && (
            <button
              type="button"
              className="recent-chat-trash"
              data-control="row"
              onClick={() => setTrashOpen(true)}
              aria-label={`回收站，${trashEntries.length} 段已删除对话`}
              title="回收站"
            >
              <SidebarIcon iconKey="trash" />
              <span className="sidebar-row-label">
                回收站（{trashEntries.length}）
              </span>
              <SidebarChevron />
            </button>
          )}
          {/* P188: an empty history can never legitimately show the notice,
              even if some other path left the module state set. */}
          {shouldShowEvictionNotice(evictionNotice, recentSessions.length) && (
            <div className="recent-chat-eviction" role="status">
              <span className="recent-chat-eviction-text">{evictionNotice}</span>
              <button
                type="button"
                className="recent-chat-eviction-close"
                aria-label="关闭提示"
                title="关闭提示"
                onClick={() => {
                  clearLastEvictionNotice();
                  setEvictionTick((n) => n + 1);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
        </section>

        {profile?.name ? (
          <section className="sidebar-section profile-card" aria-label="我的资料">
            <div className="profile-card-header">
              <h3>我的资料</h3>
              {onEditProfile && (
                <button type="button" className="profile-edit-btn" onClick={onEditProfile} aria-label="编辑资料">
                  编辑
                </button>
              )}
            </div>
            <div className="profile-card-body">
              <p className="profile-name">{profile.name}{profile.age ? `，${profile.age} 岁` : ''}</p>
              {profile.goals && <p className="profile-goals-text">{profile.goals}</p>}
              {profile.interests && profile.interests.length > 0 && (
                <div className="profile-tags">
                  {profile.interests.slice(0, 4).map((tag) => (
                    <span key={tag} className="profile-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : (
          /* P255: no profile yet — the card keeps a 「完善资料」 entry so the
           * dialog stays reachable mid-conversation, after the welcome CTA
           * has scrolled away.
           * P342: on the desktop breakpoint the card duplicates the welcome
           * block's same-copy link on the first screen, so it only renders
           * below 769px — where the aside is a closed drawer and never
           * competes with the welcome entry. Not rendering it (vs
           * display:none) keeps the sidebar column reflowed with no hole.
           * P378: the entry collapses to ONE layer — the accent-soft button
           * alone; the bordered .profile-card shell around it is gone. */
          onEditProfile && !wideViewport && (
            <section className="sidebar-section profile-setup" aria-label="我的资料">
              <button
                type="button"
                className="profile-setup-btn"
                data-control="row"
                onClick={onEditProfile}
              >
                完善资料，获得更个性化建议
              </button>
            </section>
          )
        )}

        <section className="sidebar-section" aria-label="快捷入口">
          <h3>快捷入口</h3>
          <div className="quick-prompts">
            {STARTER_ENTRIES.map((p) => (
              <button
                key={p.label}
                className="quick-btn"
                data-control="row"
                onClick={() => onQuickPrompt(p.prompt)}
                disabled={busy}
                aria-disabled={busy || undefined}
                title={busy ? '回复生成中，请稍候' : undefined}
                aria-label={`快捷提问：${p.label}`}
              >
                <SidebarIcon iconKey={p.iconKey} />
                <span className="sidebar-row-label">{p.label}</span>
                <SidebarChevron />
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section" aria-label="进阶工具">
          {/* P378: the whole block folds into a disclosure group, collapsed
              by default — the five low-frequency rows no longer compete with
              最近对话 for the drawer's first screen, and opening the group
              renders every row in full (the list keeps no max-height, so the
              last entry can never be clipped). */}
          <details className="tools-details">
            <summary className="tools-toggle">
              <h3>进阶工具</h3>
              <SidebarChevron />
            </summary>
          {/* P322: while /api/tools is in flight, paint the same five rows
              as inert skeletons — real labels in the real slots, disabled +
              aria-busy — so the drawer never looks like it only has two
              tools, and the swap to the live buttons below never changes
              the row count or height. A failed/empty response lands on the
              same TOOL_FALLBACK entries as working buttons. */}
          <ul className="tool-list">
            {toolsLoading && tools.length === 0
              ? TOOL_FALLBACK.map((t) => {
                  const label = toolDisplayName(t.name) ?? t.label;
                  return (
                    <li key={t.name} className="tool-item">
                      <button
                        type="button"
                        className="tool-entry tool-entry-skeleton shimmer"
                        data-control="row"
                        disabled
                        aria-busy="true"
                        aria-label={`进阶工具：${label}`}
                      >
                        <SidebarIcon iconKey={toolIconKey(t.name)} />
                        <span className="sidebar-row-label">{label}</span>
                        <SidebarChevron />
                      </button>
                    </li>
                  );
                })
              : (tools.length ? tools : TOOL_FALLBACK).map((t) => {
              // P316: every row is a real button — it drops a ready-to-edit
              // starter question into the composer through the same
              // onQuickPrompt prefill path the 快捷入口 entries use (no
              // auto-send; the user still presses send). A tool id with no
              // mapped intent is skipped rather than left as a dead row.
              const prompt = toolPromptFor(t.name);
              if (!prompt) return null;
              return (
                <li key={t.name} className="tool-item">
                  <button
                    type="button"
                    className="tool-entry"
                    data-control="row"
                    onClick={() => onQuickPrompt(prompt)}
                    disabled={busy}
                    aria-disabled={busy || undefined}
                    title={busy ? '回复生成中，请稍候' : undefined}
                    aria-label={`进阶工具：${toolDisplayName(t.name) ?? t.label}`}
                  >
                    <SidebarIcon iconKey={toolIconKey(t.name)} />
                    <span className="sidebar-row-label">
                      {toolDisplayName(t.name) ?? t.label}
                    </span>
                    <SidebarChevron />
                  </button>
                </li>
              );
            })}
          </ul>
          </details>
        </section>
      </div>

      <TrashSheet
        open={trashOpen}
        entries={trashEntries}
        onClose={() => setTrashOpen(false)}
        onRestore={(id) => {
          // P268: the restored chat opens in the main pane — the sheet must
          // not stay floating over it (the desktop sidebar never unmounts).
          setTrashOpen(false);
          onRestoreTrash?.(id);
        }}
        onClearAll={() => onClearTrash?.()}
      />

      <footer className="sidebar-footer">
        <button
          type="button"
          className="settings-open-btn"
          data-control="row"
          aria-label="设置"
          title="设置"
          onClick={onOpenSettings}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          设置
        </button>
      </footer>
    </aside>
  );
}
