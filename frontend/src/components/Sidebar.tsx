import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  clearLastEvictionNotice,
  getLastEvictionNotice,
} from '../lib/chatStorage';
import type { StoredChatSession } from '../lib/chatStorage';
import { shouldHandleEscape, shouldSubmitOnEnter } from '../lib/ime';
import { formatRelativeTime, isRenderableTimestamp } from '../lib/relativeTime';
import { filterRecentSessions } from '../lib/sessionFilter';
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
  busy?: boolean;
}

/** P155: gate the bulk clear behind a confirm dialog — a cancelled confirm
 * runs nothing at all. */
export function confirmClearAllChats(onClearAll?: () => void): void {
  if (window.confirm('确定清空全部历史对话？')) onClearAll?.();
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

const QUICK_PROMPTS = [
  { icon: '📝', label: '优化资料', prompt: '帮我看看交友资料怎么写更有吸引力' },
  { icon: '💬', label: '聊天回复', prompt: '对方说「周末有什么安排」，我该怎么回复？' },
  { icon: '📅', label: '约会规划', prompt: '帮我规划一次轻松自然的第一次约会' },
  { icon: '💕', label: '匹配分析', prompt: '我偏内向慢热，对方很外向，分析一下合不合适' },
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

      {recentSessions.length > 0 && (
        <section className="sidebar-section recent-chats" aria-label="最近对话">
          <div className="recent-chats-header">
            <h3>最近对话</h3>
            <button
              type="button"
              className="recent-chat-clear-all"
              onClick={() => confirmClearAllChats(onClearAllChats)}
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
          <ul className="recent-chat-list" ref={sessionListRef}>
            {shouldShowFilterEmptyHint(
              recentSessions.length,
              visibleSessions.length,
            ) && (
              <li
                className="recent-chat-empty filter-empty-hint"
                aria-live="polite"
              >
                <span className="sr-only">无匹配对话：</span>
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
                            <span aria-hidden="true">✎</span>
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
      )}

      {profile?.name && (
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
              <span aria-hidden="true">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section" aria-label="Agent 工具">
        <h3>Agent 工具</h3>
        <ul className="tool-list">
          {(tools.length ? tools : QUICK_PROMPTS.map((p, i) => ({ name: String(i), label: p.label, icon: p.icon }))).map(
            (t) => (
              <li key={t.name} className="tool-item">
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </li>
            ),
          )}
        </ul>
      </section>

      <footer className="sidebar-footer">
        <p>基于 Agent Harness 架构</p>
        <p className="muted">Tool-calling · SSE · TypeScript</p>
      </footer>
    </aside>
  );
}
