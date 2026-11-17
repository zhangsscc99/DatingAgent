import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  clearLastEvictionNotice,
  getLastEvictionNotice,
} from '../lib/chatStorage';
import type { StoredChatSession } from '../lib/chatStorage';
import { shouldHandleEscape, shouldSubmitOnEnter } from '../lib/ime';
import { formatRelativeTime, isRenderableTimestamp } from '../lib/relativeTime';
import { filterRecentSessions, matchSessionMessage } from '../lib/sessionFilter';
import { nextSessionIndex, sessionNavDirection } from '../lib/sessionListNav';
import {
  nextEditingIdAfterSessionsChange,
  nextFilterQueryAfterSessionsChange,
  shouldShowEvictionNotice,
  shouldShowFilterEmptyHint,
} from '../lib/sidebarListState';
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
  onClose?: () => void;
  onQuickPrompt: (prompt: string) => void;
  onNewChat: () => void;
  onSelectChat?: (sessionId: string) => void;
  onDeleteChat?: (sessionId: string) => void;
  onRenameChat?: (sessionId: string, title: string) => void;
  onClearAllChats?: () => void;
  onEditProfile?: () => void;
  onOpenSettings?: () => void;
  busy?: boolean;
}

/** Label the persisted message count on a session row. Pure: treats
 * undefined/null/non-array input as 0, never throws, never mutates. */
export function formatMessageCount(messages: unknown): string {
  const n = Array.isArray(messages) ? messages.length : 0;
  return `${n} 条`;
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

type QuickIconKey = 'profile' | 'chat' | 'calendar' | 'heart';

// P199: restrained inline SVGs (currentColor stroke) replace the emoji glyphs;
// the text label still carries the meaning, so every icon is aria-hidden.
const QUICK_ICON_PATHS: Record<QuickIconKey, string[]> = {
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
};

function SidebarIcon({ iconKey }: { iconKey: QuickIconKey }) {
  return (
    <svg
      className="sidebar-icon"
      width="15"
      height="15"
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

// P220: quick-entry labels are intent-shaped sentences so they can never be
// mistaken for the Agent 工具 capability names listed below.
const QUICK_PROMPTS = [
  { iconKey: 'profile', label: '帮我优化资料', prompt: '帮我看看交友资料怎么写更有吸引力' },
  { iconKey: 'chat', label: '她这样回我怎么接', prompt: '对方说「周末有什么安排」，我该怎么回复？' },
  { iconKey: 'calendar', label: '帮我规划第一次约会', prompt: '帮我规划一次轻松自然的第一次约会' },
  { iconKey: 'heart', label: '我们合不合适', prompt: '我偏内向慢热，对方很外向，分析一下合不合适' },
] as const;

// P220: when /api/tools has not loaded yet, the 工具 list falls back to the
// real capability names — never to the quick-prompt labels, which would
// render the same text twice in the drawer.
const TOOL_FALLBACK: ToolInfo[] = [
  { name: 'analyze_profile', label: '资料优化', icon: '' },
  { name: 'coach_conversation', label: '聊天指导', icon: '' },
  { name: 'plan_date', label: '约会规划', icon: '' },
  { name: 'check_compatibility', label: '匹配分析', icon: '' },
  { name: 'get_relationship_advice', label: '关系建议', icon: '' },
];

export default function Sidebar({
  tools,
  profile,
  recentSessions = [],
  activeSessionId,
  open = false,
  isMobile = false,
  onClose,
  onQuickPrompt,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onClearAllChats,
  onEditProfile,
  onOpenSettings,
  busy = false,
}: Props) {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
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
  const visibleSessions = filterRecentSessions(recentSessions, filterQuery);
  const sessionGroups = groupSessionsByDay(visibleSessions);

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
      className={`sidebar${isMobile ? ' sidebar-drawer' : ''}${isMobile && open ? ' open' : ''}`}
      aria-label="导航侧边栏"
      aria-hidden={isMobile ? !open : undefined}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? open : undefined}
      inert={isMobile && !open ? true : undefined}
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

      <button className="new-chat-btn" onClick={onNewChat} aria-label="开始新对话">
        + 新对话
      </button>

      <section className="sidebar-section recent-chats" aria-label="最近对话">
        <div className="recent-chats-header">
          <h3>最近对话</h3>
          <button
            type="button"
            className="recent-chat-clear-all"
            // P228: App owns the in-app confirm dialog; this only asks.
            onClick={() => onClearAllChats?.()}
            disabled={busy || recentSessions.length === 0}
            aria-label="清空全部历史对话"
            title="清空全部历史对话"
          >
            清空全部
          </button>
        </div>
        <input
          type="text"
          className="recent-chat-filter"
          value={filterQuery}
          placeholder="筛选对话"
          aria-label="筛选对话"
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
            ) && (
              <li
                className="recent-chat-empty filter-empty-hint"
                aria-live="polite"
                aria-label="无匹配对话"
              >
                <span className="filter-empty-hint-text">
                  没有匹配「{filterQuery.trim()}」的对话
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
                  const trimmedQuery = filterQuery.trim().toLowerCase();
                  const bodyMatch =
                    trimmedQuery &&
                    !s.title.toLowerCase().includes(trimmedQuery)
                      ? matchSessionMessage(s, filterQuery)
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
                            onClick={() => onSelectChat?.(s.id)}
                            onKeyDown={handleSessionItemKeyDown}
                            disabled={busy}
                            aria-disabled={busy || undefined}
                            title={s.title}
                            aria-current={s.id === activeSessionId ? 'true' : undefined}
                          >
                            <span className="recent-chat-title">{s.title}</span>
                            {bodyMatch && (
                              <span className="recent-chat-excerpt">
                                {bodyMatch.excerpt}
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
        {/* P230: announce how many conversations the filter matched, at
            most once per query change; blank while the box is empty so
            mounting the section never announces a count. P245: a zero-match
            query is already announced by the filter-empty-hint li's own
            aria-live, so this region stays silent there instead of doubling
            the empty-state copy with a second generic message. */}
        <span className="sr-only" role="status" aria-live="polite">
          {filterQuery.trim() && visibleSessions.length > 0
            ? `找到 ${visibleSessions.length} 段对话`
            : ''}
        </span>
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
         * has scrolled away. */
        onEditProfile && (
          <section className="sidebar-section profile-card" aria-label="我的资料">
            <button
              type="button"
              className="profile-setup-btn"
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
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.label}
              className="quick-btn"
              onClick={() => onQuickPrompt(p.prompt)}
              disabled={busy}
              aria-disabled={busy || undefined}
              title={busy ? '回复生成中，请稍候' : undefined}
              aria-label={`快捷提问：${p.label}`}
            >
              <SidebarIcon iconKey={p.iconKey} />
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section" aria-label="Agent 工具">
        <h3>Agent 工具</h3>
        <ul className="tool-list">
          {(tools.length ? tools : TOOL_FALLBACK).map(
            (t) => (
              <li key={t.name} className="tool-item">
                {t.label}
              </li>
            ),
          )}
        </ul>
      </section>

      <footer className="sidebar-footer">
        <button
          type="button"
          className="settings-open-btn"
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
