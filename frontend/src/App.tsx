import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ChatMessage, StreamPhase, ToolEvent, ToolInfo, UserProfile } from './types';
import ChatWindow from './components/ChatWindow';
import Sidebar from './components/Sidebar';
import ProfileOnboarding from './components/ProfileOnboarding';
import { useMediaQuery } from './hooks/useMediaQuery';
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
import './App.css';

const TOOL_LABELS: Record<string, string> = {
  analyze_profile: '资料优化',
  coach_conversation: '聊天指导',
  plan_date: '约会规划',
  check_compatibility: '匹配分析',
  get_relationship_advice: '关系建议',
};

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
  const [restoringSession, setRestoringSession] = useState(() => {
    const { activeSessionId, sessions } = loadChatState();
    const session = sessions.find((s) => s.id === activeSessionId);
    return Boolean(session && session.messages.length > 0);
  });
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

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

  useEffect(() => {
    if (loading || !sessionId) return;
    const completed = messages.filter((m) => !m.streaming);
    if (completed.length === 0) return;
    saveChatSession(sessionId, messages);
    setRecentSessions(getRecentSessions());
  }, [messages, sessionId, loading]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const prompt = text.trim();
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: prompt,
      };
      const assistantId = `a-${Date.now()}`;
      const toolEvents: ToolEvent[] = [];

      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
          streamPhase: 'thinking',
        },
      ]);
      setLoading(true);

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
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
              const sid = (event.data as { sessionId: string }).sessionId;
              if (sid) setSessionId(sid);
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
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, profile],
  );

  const handleRetry = useCallback(
    (messageId: string, prompt: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      sendMessage(prompt);
    },
    [sendMessage],
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
          <div className="header-status" role="status" aria-live="polite">
            <span
              className={`status-dot ${health?.llmConfigured ? 'live' : 'mock'}`}
              aria-hidden="true"
            />
            {health?.llmConfigured ? 'LLM 已连接' : 'Demo 模式'}
          </div>
        </header>
        <ChatWindow
          messages={messages}
          loading={loading}
          restoring={restoringSession}
          profile={profile}
          onSend={sendMessage}
          onRetry={handleRetry}
          onSetupProfile={() => setEditingProfile(true)}
        />
      </main>
    </div>
  );
}
