import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentEvent,
  ChatMessage,
  ReplyLanguage,
  StreamPhase,
  ToolEvent,
  ToolInfo,
  UserProfile,
} from './types';
import ChatWindow from './components/ChatWindow';
import Sidebar from './components/Sidebar';
import ProfileOnboarding from './components/ProfileOnboarding';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useTheme } from './hooks/useTheme';
import {
  clearActiveSession,
  getRecentSessions,
  loadChatState,
  saveChatSession,
  setActiveSessionId,
  syncSessionWithBackend,
} from './lib/chatStorage';
import {
  isOnboardingComplete,
  loadProfile,
  markOnboardingComplete,
  saveProfile,
} from './lib/profileStorage';
import {
  buildConversationMarkdown,
  conversationFilename,
  downloadMarkdown,
  exportableMessages,
} from './lib/exportConversation';
import './App.css';

const TOOL_LABELS: Record<string, string> = {
  analyze_profile: '资料优化',
  coach_conversation: '聊天指导',
  plan_date: '约会规划',
  check_compatibility: '匹配分析',
  get_relationship_advice: '关系建议',
};

/** Reply-language preference, persisted so it survives reloads. */
const LANGUAGE_KEY = 'datingagent.replyLanguage';

function readStoredLanguage(): ReplyLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored === 'zh' || stored === 'en' || stored === 'auto') return stored;
  } catch {
    // Private mode / storage disabled — fall back to auto.
  }
  return 'auto';
}

/** Human-readable message for a failed chat request, using the API's JSON error shape. */
async function describeChatError(res: Response): Promise<string> {
  const retryAfter = res.headers.get('Retry-After');
  if (res.status === 429) {
    return `请求过于频繁，请 ${retryAfter ? `${retryAfter} 秒` : '稍'}后再试`;
  }
  if (res.status === 413) return '消息太长了，请精简到 4000 字以内再发送';

  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // Non-JSON error body — fall through to the status code.
  }
  return `HTTP ${res.status}`;
}

function upsertAssistant(
  prev: ChatMessage[],
  assistantId: string,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === assistantId);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { ...next[idx], ...patch };
    return next;
  }
  return [
    ...prev,
    {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      streamPhase: 'thinking',
      ...patch,
    },
  ];
}

function readInitialChat(): { messages: ChatMessage[]; sessionId: string | null } {
  const { activeSessionId, sessions } = loadChatState();
  if (!activeSessionId) return { messages: [], sessionId: null };
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session) return { messages: [], sessionId: null };
  return { messages: session.messages, sessionId: session.id };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readInitialChat().messages);
  const [sessionId, setSessionId] = useState<string | null>(() => readInitialChat().sessionId);
  const [recentSessions, setRecentSessions] = useState(() => getRecentSessions());
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [health, setHealth] = useState<{ llmConfigured: boolean } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingComplete());
  const [editingProfile, setEditingProfile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [language, setLanguage] = useState<ReplyLanguage>(() => readStoredLanguage());
  const exportTimer = useRef<number | null>(null);
  const [restoringSession, setRestoringSession] = useState(() => {
    const { activeSessionId, sessions } = loadChatState();
    const session = sessions.find((s) => s.id === activeSessionId);
    return Boolean(session && session.messages.length > 0);
  });
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    fetch('/api/tools')
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .catch(() => {});

    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const { activeSessionId, sessions } = loadChatState();
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session && session.messages.length > 0) {
      syncSessionWithBackend(session.id, session.messages, loadProfile()).finally(() => {
        setRestoringSession(false);
      });
    } else {
      setRestoringSession(false);
    }
  }, []);

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  useEffect(
    () => () => {
      if (exportTimer.current !== null) window.clearTimeout(exportTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (loading || !sessionId) return;
    const completed = messages.filter((m) => !m.streaming);
    if (completed.length === 0) return;
    saveChatSession(sessionId, messages);
    setRecentSessions(getRecentSessions());
  }, [messages, sessionId, loading]);

  /**
   * Stream one assistant reply into `assistantId`. The caller owns the user
   * bubble and the loading flag, so a retry can re-run the turn without
   * appending a second copy of the same user message.
   */
  const streamReply = useCallback(
    async (prompt: string, assistantId: string) => {
      const toolEvents: ToolEvent[] = [];

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const patchAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) => upsertAssistant(prev, assistantId, patch));
      };

      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: prompt,
            profile: profile ?? undefined,
            language,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(await describeChatError(res));
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalContent = '';
        let streamPhase: StreamPhase = 'thinking';
        let streamError: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6)) as AgentEvent;

            if (event.type === 'thinking') {
              streamPhase = 'thinking';
              patchAssistant({ streamPhase, streaming: true });
            }

            if (event.type === 'tool_start') {
              const d = event.data as { name: string };
              toolEvents.push({
                name: d.name,
                label: TOOL_LABELS[d.name] ?? d.name,
                status: 'running',
              });
              streamPhase = 'tool';
              patchAssistant({
                streamPhase,
                streaming: true,
                toolEvents: [...toolEvents],
              });
            }

            if (event.type === 'tool_end') {
              const d = event.data as { name: string; result: unknown };
              const idx = toolEvents.findIndex((t) => t.name === d.name && t.status === 'running');
              if (idx >= 0) {
                toolEvents[idx] = { ...toolEvents[idx], status: 'done', result: d.result };
              }
              const allDone = toolEvents.every((t) => t.status === 'done');
              streamPhase = allDone ? 'generating' : 'tool';
              patchAssistant({
                streamPhase,
                streaming: true,
                toolEvents: [...toolEvents],
              });
            }

            if (event.type === 'message') {
              finalContent = (event.data as { content: string }).content;
              streamPhase = 'generating';
              patchAssistant({
                content: finalContent,
                streamPhase,
                streaming: true,
                toolEvents: toolEvents.length ? [...toolEvents] : undefined,
              });
            }

            if (event.type === 'done') {
              const d = event.data as {
                sessionId: string;
                tool?: string;
                tokens?: number;
                latencyMs?: number;
              };
              if (d.sessionId) setSessionId(d.sessionId);
              // F21: only attach a badge when the provider reported token usage.
              if (typeof d.tokens === 'number') {
                patchAssistant({
                  meta: { tool: d.tool, tokens: d.tokens, latencyMs: d.latencyMs },
                });
              }
            }

            if (event.type === 'error') {
              streamError = (event.data as { message: string }).message;
            }
          }
        }

        if (streamError) {
          patchAssistant({
            content: `出错了：${streamError}`,
            streaming: false,
            error: true,
            retryPrompt: prompt,
            toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          });
        } else if (!finalContent) {
          patchAssistant({
            content: '暂无回复，请重试。',
            streaming: false,
            error: true,
            retryPrompt: prompt,
            toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          });
        } else {
          patchAssistant({
            content: finalContent,
            streaming: false,
            streamPhase: undefined,
            toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          });
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        patchAssistant({
          content: `请求失败：${(err as Error).message}`,
          streaming: false,
          error: true,
          retryPrompt: prompt,
        });
      }
    },
    [profile, sessionId, language],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const prompt = text.trim();
      const now = Date.now();
      const assistantId = `a-${now}`;

      setMessages((prev) => [
        ...prev,
        { id: `u-${now}`, role: 'user', content: prompt, createdAt: now },
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: now,
          streaming: true,
          streamPhase: 'thinking',
        },
      ]);
      setLoading(true);

      try {
        await streamReply(prompt, assistantId);
      } finally {
        setLoading(false);
      }
    },
    [loading, streamReply],
  );

  /**
   * Re-run the failed turn. The user bubble is reused when it is still the one
   * right before the error, so retrying never duplicates the message in the
   * visible conversation (or in the transcript sent back to the API).
   */
  const handleRetry = useCallback(
    (messageId: string, prompt: string) => {
      if (loading) return;

      const failedIndex = messages.findIndex((m) => m.id === messageId);
      // Only the newest turn can be retried; anything else would append an
      // out-of-order reply.
      if (failedIndex < 0 || failedIndex !== messages.length - 1) return;

      const previous = messages[failedIndex - 1];
      const reuseUserBubble = previous?.role === 'user' && previous.content === prompt;
      const now = Date.now();
      const assistantId = `a-${now}`;
      const retryUser: ChatMessage[] = reuseUserBubble
        ? []
        : [{ id: `u-${now}`, role: 'user', content: prompt, createdAt: now }];
      const retryAssistant: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        streaming: true,
        streamPhase: 'thinking',
      };

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== messageId),
        ...retryUser,
        retryAssistant,
      ]);
      setLoading(true);
      void streamReply(prompt, assistantId).finally(() => setLoading(false));
    },
    [loading, messages, streamReply],
  );

  const handleProfileSave = (next: UserProfile) => {
    saveProfile(next);
    setProfile(next);
    markOnboardingComplete();
    setShowOnboarding(false);
    setEditingProfile(false);
  };

  const handleProfileSkip = () => {
    markOnboardingComplete();
    setShowOnboarding(false);
  };

  const handleQuickPrompt = (prompt: string) => sendMessage(prompt);

  const canExport = exportableMessages(messages).length > 0;

  const handleExport = useCallback(() => {
    const markdown = buildConversationMarkdown(messages);
    const ok = downloadMarkdown(markdown, conversationFilename());
    if (!ok) {
      setExportState('failed');
    } else {
      setExportState('done');
    }
    if (exportTimer.current !== null) window.clearTimeout(exportTimer.current);
    exportTimer.current = window.setTimeout(() => {
      setExportState('idle');
      exportTimer.current = null;
    }, 1500);
  }, [messages]);

  const closeSidebar = () => setSidebarOpen(false);

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setLoading(false);
    clearActiveSession();
    closeSidebar();
  };

  const handleSelectChat = (id: string) => {
    if (id === sessionId) {
      closeSidebar();
      return;
    }
    abortRef.current?.abort();
    const session = getRecentSessions().find((s) => s.id === id);
    if (!session) return;
    setRestoringSession(true);
    setSessionId(session.id);
    setMessages(session.messages);
    setActiveSessionId(session.id);
    setLoading(false);
    syncSessionWithBackend(session.id, session.messages, profile).finally(() => {
      setRestoringSession(false);
    });
    closeSidebar();
  };

  return (
    <div className="app">
      <Sidebar
        tools={tools}
        profile={profile}
        recentSessions={recentSessions}
        activeSessionId={sessionId}
        open={sidebarOpen}
        isMobile={isMobile}
        onClose={closeSidebar}
        onQuickPrompt={(prompt) => {
          handleQuickPrompt(prompt);
          closeSidebar();
        }}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onEditProfile={() => {
          setEditingProfile(true);
          closeSidebar();
        }}
      />
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭菜单"
          onClick={closeSidebar}
        />
      )}
      <ProfileOnboarding
        open={showOnboarding || editingProfile}
        initialProfile={profile}
        allowSkip={showOnboarding && !editingProfile}
        onSave={handleProfileSave}
        onSkip={showOnboarding && !editingProfile ? handleProfileSkip : undefined}
        onClose={editingProfile ? () => setEditingProfile(false) : undefined}
      />
      <main className="main">
        <header className="header">
          <div className="header-left">
            {isMobile && (
              <button
                type="button"
                className="menu-btn"
                aria-label="打开菜单"
                aria-expanded={sidebarOpen}
                aria-controls="app-sidebar"
                onClick={() => setSidebarOpen((v) => !v)}
              >
                <span className="menu-icon" aria-hidden="true" />
              </button>
            )}
            <div className="header-title">
              <span className="logo">🌹</span>
              <div>
                <h1>DatingAgent</h1>
                <p className="subtitle">AI 恋爱关系顾问 · Agent Harness</p>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <label className="lang-select" title="选择回复语言（自动跟随对话）">
              <span className="lang-select-icon" aria-hidden="true">
                🌐
              </span>
              <select
                className="lang-select-input"
                value={language}
                onChange={(e) => {
                  const next = e.target.value as ReplyLanguage;
                  setLanguage(next);
                  try {
                    localStorage.setItem(LANGUAGE_KEY, next);
                  } catch {
                    // Storage unavailable — the choice still applies to this session.
                  }
                }}
                aria-label="回复语言"
              >
                <option value="auto">自动</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button
              type="button"
              className="theme-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? '当前：深色 · 点击切换浅色' : '当前：浅色 · 点击切换深色'}
            >
              <span className="theme-icon" aria-hidden="true">
                {theme === 'dark' ? '☀' : '☾'}
              </span>
            </button>
            <button
              type="button"
              className={`export-btn${exportState === 'done' ? ' done' : ''}${
                exportState === 'failed' ? ' failed' : ''
              }`}
              onClick={handleExport}
              disabled={!canExport}
              aria-label="导出当前对话为 Markdown"
              title={
                canExport
                  ? '把当前对话导出为 Markdown 文件'
                  : exportState === 'failed'
                    ? '导出失败，请稍后重试'
                    : '暂无内容可导出'
              }
            >
              {exportState === 'done'
                ? '✓ 已导出'
                : exportState === 'failed'
                  ? '导出失败'
                  : '⬇ 导出 Markdown'}
            </button>
            <span className="export-status" role="status" aria-live="polite">
              {exportState === 'done' ? '已下载 Markdown 文件' : exportState === 'failed' ? '导出失败' : ''}
            </span>
            <div className="header-status" role="status" aria-live="polite">
              <span
                className={`status-dot ${health?.llmConfigured ? 'live' : 'mock'}`}
                aria-hidden="true"
              />
              {health?.llmConfigured ? 'LLM 已连接' : 'Demo 模式'}
            </div>
          </div>
        </header>
        <ChatWindow
          messages={messages}
          loading={loading}
          restoring={restoringSession}
          profile={profile}
          sessionId={sessionId}
          onSend={sendMessage}
          onRetry={handleRetry}
          onSetupProfile={() => setEditingProfile(true)}
        />
      </main>
    </div>
  );
}
