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
import ServiceBanner from './components/ServiceBanner';
import Sidebar from './components/Sidebar';
import ProfileOnboarding from './components/ProfileOnboarding';
import SystemStatusFooter from './components/SystemStatusFooter';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useTheme } from './hooks/useTheme';
import {
  activeChatFromState,
  clearActiveSession,
  clearAllChatSessions,
  deleteChatSession,
  getRecentSessions,
  loadChatState,
  renameChatSession,
  saveChatSession,
  setActiveSessionId,
  syncSessionWithBackend,
  watchChatStorage,
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
import { copyText } from './lib/clipboard';
import { createErrorToast, type ErrorToastState } from './lib/errorToast';
import { pushInputHistory } from './lib/inputHistory';
import { regeneratePromptFor } from './lib/regenerate';
import { parseRateLimit, type RateLimitBudget } from './lib/rateLimitStatus';
import { isServiceDown } from './lib/serviceStatus';
import './App.css';

const STREAM_PHASE_LABELS: Record<StreamPhase, string> = {
  thinking: '正在思考',
  tool: '正在调用工具',
  generating: '正在生成回复',
};

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

/** Document lang for the reply-language preference; the shell stays Chinese except for explicit English. */
export function documentLangFor(language: ReplyLanguage): string {
  return language === 'en' ? 'en' : 'zh-CN';
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

/** Result of one streamed reply; P26 uses it to restore a failed regeneration. */
type StreamOutcome =
  | { status: 'ok' }
  | { status: 'error'; errorText: string; serviceDown?: boolean }
  | { status: 'aborted' };

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
  return activeChatFromState(loadChatState());
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
  const [copyExportState, setCopyExportState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [language, setLanguage] = useState<ReplyLanguage>(() => readStoredLanguage());
  // P07: last known per-IP request budget, from chat response headers; stays
  // null until the first response so nothing is fabricated at startup.
  const [rateLimit, setRateLimit] = useState<RateLimitBudget | null>(null);
  const exportTimer = useRef<number | null>(null);
  const copyExportTimer = useRef<number | null>(null);
  // P11: top banner for outage-class failures (network error or HTTP 5xx).
  const [serviceDownBanner, setServiceDownBanner] = useState(false);
  // P17: single-slot error toast — a fresh failure replaces it and restarts
  // the 8 s auto-dismiss window.
  const [errorToast, setErrorToast] = useState<ErrorToastState | null>(null);
  const [toastCtl] = useState(() => createErrorToast(setErrorToast));
  const [restoringSession, setRestoringSession] = useState(() => {
    const { activeSessionId, sessions } = loadChatState();
    const session = sessions.find((s) => s.id === activeSessionId);
    return Boolean(session && session.messages.length > 0);
  });
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { theme, toggle: toggleTheme } = useTheme();
  // P154: browser connectivity — a dropped network surfaces a dim line above
  // the composer instead of only the generic P11 service banner.
  const online = useOnlineStatus();

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
    document.documentElement.lang = documentLangFor(language);
  }, [language]);

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
      if (copyExportTimer.current !== null) window.clearTimeout(copyExportTimer.current);
      toastCtl.destroy();
    },
    [toastCtl],
  );

  // P156: the storage watcher below binds once on mount, so it reads the
  // streaming flag through a ref rather than re-subscribing on every change.
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // P156: a write to the chat-history key from another tab fires `storage`
  // here — reload so the sidebar list and the open conversation match the
  // shared store. An in-flight stream is never interrupted; the refresh is
  // skipped instead of aborting the reply.
  useEffect(
    () =>
      watchChatStorage(() => {
        if (loadingRef.current) return;
        setRecentSessions(getRecentSessions());
        const next = activeChatFromState(loadChatState());
        setSessionId(next.sessionId);
        setMessages(next.messages);
      }),
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
    async (prompt: string, assistantId: string): Promise<StreamOutcome> => {
      const toolEvents: ToolEvent[] = [];
      let finalContent = '';
      // P11: the response status feeds the outage classifier when the turn
      // fails — stays undefined when the request never got a response.
      let httpStatus: number | undefined;

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
        httpStatus = res.status;

        // P07: headers arrive before the stream body, and error replies (e.g.
        // 429) carry the same budget — update whenever they are present.
        const budget = parseRateLimit(res.headers);
        if (budget) setRateLimit(budget);

        if (!res.ok) throw new Error(await describeChatError(res));
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
          const errorText = `出错了：${streamError}`;
          patchAssistant({
            content: errorText,
            streaming: false,
            error: true,
            retryPrompt: prompt,
            toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          });
          return { status: 'error', errorText };
        }
        if (!finalContent) {
          const errorText = '暂无回复，请重试。';
          patchAssistant({
            content: errorText,
            streaming: false,
            error: true,
            retryPrompt: prompt,
            toolEvents: toolEvents.length ? [...toolEvents] : undefined,
          });
          return { status: 'error', errorText };
        }
        patchAssistant({
          content: finalContent,
          streaming: false,
          streamPhase: undefined,
          toolEvents: toolEvents.length ? [...toolEvents] : undefined,
        });
        return { status: 'ok' };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // P12: user-initiated stop — keep whatever partial text arrived and
          // mark the bubble instead of raising an error. Skip the patch when
          // the bubble is gone (session switched / new chat while in flight).
          setMessages((prev) =>
            prev.some((m) => m.id === assistantId)
              ? upsertAssistant(prev, assistantId, {
                  content: finalContent,
                  streaming: false,
                  streamPhase: undefined,
                  stopped: true,
                  toolEvents: toolEvents.length ? [...toolEvents] : undefined,
                })
              : prev,
          );
          return { status: 'aborted' };
        }
        const errorText = `请求失败：${(err as Error).message}`;
        // P11: fetch rejects with TypeError on a transport failure; the thrown
        // describeChatError above is a plain Error carrying the HTTP status.
        const serviceDown = isServiceDown({
          networkError: err instanceof TypeError,
          status: httpStatus,
        });
        patchAssistant({
          content: errorText,
          streaming: false,
          error: true,
          retryPrompt: prompt,
        });
        return { status: 'error', errorText, serviceDown };
      }
    },
    [profile, sessionId, language],
  );

  /**
   * P11: reconcile the outage banner with a finished turn — a success or a
   * non-outage error hides it, a qualifying failure shows (or re-shows) it.
   */
  const noteStreamOutcome = useCallback(
    (outcome: StreamOutcome) => {
      if (outcome.status === 'aborted') return;
      setServiceDownBanner(outcome.status === 'error' && Boolean(outcome.serviceDown));
      // P17: every failed turn surfaces a transient toast; a success resolves it.
      if (outcome.status === 'error') toastCtl.show(outcome.errorText);
      else toastCtl.dismiss();
    },
    [toastCtl],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const prompt = text.trim();
      const now = Date.now();
      const assistantId = `a-${now}`;

      // P06: the composer draft is already cleared; remember the message for
      // ArrowUp recall (purely client-side, best-effort localStorage).
      pushInputHistory(prompt);
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
        const outcome = await streamReply(prompt, assistantId);
        noteStreamOutcome(outcome);
      } finally {
        setLoading(false);
      }
    },
    [loading, streamReply, noteStreamOutcome],
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
      void streamReply(prompt, assistantId)
        .then(noteStreamOutcome)
        .finally(() => setLoading(false));
    },
    [loading, messages, streamReply, noteStreamOutcome],
  );

  /**
   * P11: banner retry funnels through the same F09 path as the bubble button —
   * the newest retryable error bubble is re-issued without duplicating history.
   */
  const handleServiceRetry = useCallback(() => {
    if (loading) return;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role === 'assistant' && m.error && m.retryPrompt) {
        handleRetry(m.id, m.retryPrompt);
        return;
      }
    }
  }, [loading, messages, handleRetry]);

  /** P17: toast retry shares the banner's path — newest failed turn, no dupes. */
  const handleToastRetry = useCallback(() => {
    toastCtl.dismiss();
    handleServiceRetry();
  }, [toastCtl, handleServiceRetry]);

  /**
   * P26: re-issue the prompt that produced the last assistant reply, replacing
   * that bubble in place — no new user bubble, no orphaned old reply. On
   * failure the original content/meta is restored and the error is shown
   * alongside it, so the previous reply is never lost.
   */
  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (loading) return;
      const prompt = regeneratePromptFor(messages, messageId);
      if (!prompt) return;

      const target = messages[messages.length - 1];
      const original = {
        content: target.content,
        toolEvents: target.toolEvents,
        meta: target.meta,
      };

      // The session can be cleared while a request is in flight; never let a
      // late patch resurrect a bubble that no longer exists.
      const patchIfPresent = (patch: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.some((m) => m.id === messageId) ? upsertAssistant(prev, messageId, patch) : prev,
        );
      };

      patchIfPresent({
        streaming: true,
        regenerating: true,
        streamPhase: 'thinking',
        toolEvents: undefined,
        meta: undefined,
      });
      setLoading(true);
      void streamReply(prompt, messageId)
        .then((outcome) => {
          noteStreamOutcome(outcome);
          if (outcome.status === 'error') {
            patchIfPresent({
              content: original.content,
              toolEvents: original.toolEvents,
              meta: original.meta,
              streaming: false,
              streamPhase: undefined,
              error: true,
              errorDetail: outcome.errorText,
              retryPrompt: prompt,
            });
          }
          patchIfPresent({ regenerating: undefined });
        })
        .finally(() => setLoading(false));
    },
    [loading, messages, streamReply, noteStreamOutcome],
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

  /** P12: abort the in-flight stream; the catch in streamReply finishes the turn. */
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Never leave a fetch running past unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

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

  const handleCopyMarkdown = useCallback(async () => {
    const markdown = buildConversationMarkdown(messages);
    const ok = await copyText(markdown);
    setCopyExportState(ok ? 'done' : 'failed');
    if (copyExportTimer.current !== null) window.clearTimeout(copyExportTimer.current);
    copyExportTimer.current = window.setTimeout(() => {
      setCopyExportState('idle');
      copyExportTimer.current = null;
    }, 2000);
  }, [messages]);

  const closeSidebar = () => setSidebarOpen(false);

  const streamingPhase = messages.find((m) => m.streaming)?.streamPhase;
  const streamAnnouncement = streamingPhase
    ? `正在生成…${STREAM_PHASE_LABELS[streamingPhase]}`
    : '';

  const handleNewChat = () => {
    abortRef.current?.abort();
    toastCtl.dismiss();
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
    toastCtl.dismiss();
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

  /**
   * P148: delete one stored session. The backend DELETE is fire-and-forget —
   * the local copy is the source of truth for the list, and a dropped request
   * only leaves an idle backend session that the F01 TTL reaps anyway.
   */
  const handleDeleteChat = (id: string) => {
    const title = recentSessions.find((s) => s.id === id)?.title ?? id;
    if (!window.confirm(`删除对话「${title}」？`)) return;

    deleteChatSession(id);
    setRecentSessions(getRecentSessions());

    try {
      void fetch(`/api/session/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    } catch {
      /* fire-and-forget */
    }

    if (id === sessionId) {
      abortRef.current?.abort();
      toastCtl.dismiss();
      setMessages([]);
      setSessionId(null);
      setLoading(false);
    }
  };

  /**
   * P155: wipe every stored session and reset the chat surface. The sidebar
   * button already confirmed, so reaching here always clears — messages, the
   * active id, and any stale banner/toast all reset to a clean empty chat.
   */
  const handleClearAllChats = () => {
    clearAllChatSessions();
    setRecentSessions([]);
    abortRef.current?.abort();
    toastCtl.dismiss();
    setServiceDownBanner(false);
    setMessages([]);
    setSessionId(null);
    setLoading(false);
    setRestoringSession(false);
    closeSidebar();
  };

  /** P149: rename a stored session. Purely local — never touches the active
   * chat, and the next saveChatSession keeps the custom title. */
  const handleRenameChat = (id: string, title: string) => {
    renameChatSession(id, title);
    setRecentSessions(getRecentSessions());
  };

  return (
    <div className="app">
      <span className="sr-only" role="status" aria-live="polite">
        {streamAnnouncement}
      </span>
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
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onClearAllChats={handleClearAllChats}
        busy={loading}
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
              aria-label={
                exportState === 'done'
                  ? '已导出'
                  : exportState === 'failed'
                    ? '导出失败'
                    : '导出 Markdown'
              }
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
            <button
              type="button"
              data-testid="copy-markdown"
              className={`copy-export-btn${copyExportState === 'done' ? ' done' : ''}${
                copyExportState === 'failed' ? ' failed' : ''
              }`}
              onClick={() => {
                void handleCopyMarkdown();
              }}
              disabled={!canExport}
              aria-label={
                copyExportState === 'done'
                  ? '已复制'
                  : copyExportState === 'failed'
                    ? '复制失败'
                    : '复制 Markdown'
              }
              title={
                canExport
                  ? '把当前对话以 Markdown 格式复制到剪贴板'
                  : copyExportState === 'failed'
                    ? '复制失败，请稍后重试'
                    : '暂无内容可复制'
              }
            >
              {copyExportState === 'done'
                ? '✓ 已复制'
                : copyExportState === 'failed'
                  ? '复制失败'
                  : '⧉ 复制 Markdown'}
            </button>
            <span className="export-status" role="status" aria-live="polite">
              {copyExportState === 'done'
                ? '已复制到剪贴板'
                : copyExportState === 'failed'
                  ? '复制失败'
                  : exportState === 'done'
                    ? '已下载 Markdown 文件'
                    : exportState === 'failed'
                      ? '导出失败'
                      : ''}
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
        <ServiceBanner
          visible={serviceDownBanner}
          retrying={loading}
          onRetry={handleServiceRetry}
          onDismiss={() => setServiceDownBanner(false)}
        />
        <ChatWindow
          messages={messages}
          loading={loading}
          restoring={restoringSession}
          profile={profile}
          sessionId={sessionId}
          onSend={sendMessage}
          onStop={stopStreaming}
          onRetry={handleRetry}
          onRegenerate={handleRegenerate}
          onSetupProfile={() => setEditingProfile(true)}
          rateLimit={rateLimit}
          offline={!online}
          errorToast={errorToast}
          onToastRetry={handleToastRetry}
          onToastDismiss={toastCtl.dismiss}
        />
        <SystemStatusFooter />
      </main>
    </div>
  );
}
