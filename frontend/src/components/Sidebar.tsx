import { useEffect, useRef } from 'react';
import type { StoredChatSession } from '../lib/chatStorage';
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
  onEditProfile?: () => void;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
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
  onEditProfile,
}: Props) {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

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
          <h3>最近对话</h3>
          <ul className="recent-chat-list">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`recent-chat-item${s.id === activeSessionId ? ' active' : ''}`}
                  onClick={() => onSelectChat?.(s.id)}
                  title={s.title}
                  aria-current={s.id === activeSessionId ? 'true' : undefined}
                >
                  <span className="recent-chat-title">{s.title}</span>
                  <span className="recent-chat-time">{formatRelativeTime(s.updatedAt)}</span>
                </button>
              </li>
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
