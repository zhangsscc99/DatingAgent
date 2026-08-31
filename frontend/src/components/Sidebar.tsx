import type { ToolInfo } from '../types';
import './Sidebar.css';

interface Props {
  tools: ToolInfo[];
  onQuickPrompt: (prompt: string) => void;
  onNewChat: () => void;
}

const QUICK_PROMPTS = [
  { icon: '📝', label: '优化资料', prompt: '帮我看看交友资料怎么写更有吸引力' },
  { icon: '💬', label: '聊天回复', prompt: '对方说「周末有什么安排」，我该怎么回复？' },
  { icon: '📅', label: '约会规划', prompt: '帮我规划一次轻松自然的第一次约会' },
  { icon: '💕', label: '匹配分析', prompt: '我偏内向慢热，对方很外向，分析一下合不合适' },
];

export default function Sidebar({ tools, onQuickPrompt, onNewChat }: Props) {
  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        + 新对话
      </button>

      <section className="sidebar-section">
        <h3>快捷入口</h3>
        <div className="quick-prompts">
          {QUICK_PROMPTS.map((p) => (
            <button key={p.label} className="quick-btn" onClick={() => onQuickPrompt(p.prompt)}>
              <span>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section">
        <h3>Agent 工具</h3>
        <ul className="tool-list">
          {(tools.length ? tools : QUICK_PROMPTS.map((p, i) => ({ name: String(i), label: p.label, icon: p.icon }))).map(
            (t) => (
              <li key={t.name} className="tool-item">
                <span>{t.icon}</span>
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
