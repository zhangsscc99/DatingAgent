import { Fragment, useEffect, useRef, useState } from 'react';
import type { StoredChatSession } from '../lib/chatStorage';
import { formatRelativeTime } from '../lib/relativeTime';
import type { ToolInfo, UserProfile } from '../types';
import './Sidebar.css';

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

export function filterRecentSessions(
  sessions: StoredChatSession[],
  query: string,
): StoredChatSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q));
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
 * never mutates the input. Invalid/missing updatedAt lands in 更早. */
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
    const dayStart = localDayStart(s.updatedAt);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const visibleSessions = filterRecentSessions(recentSessions, filterQuery);
  const sessionGroups = groupSessionsByDay(visibleSessions);

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

  return (
    <aside
      ref={sidebarRef}
      id="app-sidebar"
      className={`sidebar${isMobile ? ' sidebar-drawer' : ''}${isMobile && open ? ' open' : ''}`}
      aria-label="导航侧边栏"
      aria-hidden={isMobile ? !open : undefined}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? open : undefined}
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
              if (e.key === 'Escape') {
                setFilterQuery('');
                e.currentTarget.blur();
              }
            }}
          />
          <ul className="recent-chat-list">
            {visibleSessions.length === 0 && (
              <li className="recent-chat-empty" aria-live="polite">
                无匹配对话
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
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onBlur={commitRename}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`recent-chat-item${s.id === activeSessionId ? ' active' : ''}`}
                            onClick={() => onSelectChat?.(s.id)}
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
