import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ReplyLanguage,
  StreamPhase,
  ToolEvent,
  ToolInfo,
  ToolPhaseKind,
  UserProfile,
} from './types';
import ChatWindow, { type ChatWindowHandle } from './components/ChatWindow';
import ServiceBanner from './components/ServiceBanner';
import Sidebar from './components/Sidebar';
import ConfirmDialog from './components/ConfirmDialog';
import HeaderMoreMenu from './components/HeaderMoreMenu';
import ProfileOnboarding from './components/ProfileOnboarding';
import SettingsSheet from './components/SettingsSheet';
import SystemStatusFooter from './components/SystemStatusFooter';
import UndoToast from './components/UndoToast';
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
  newSessionId,
  remapChatSessionId,
  renameChatSession,
  restoreChatSession,
  restoreChatState,
  sameConversation,
  sameRecentSessions,
  saveChatSession,
  sessionTitle,
  setActiveSessionId,
  syncSessionWithBackend,
  watchChatStorage,
} from './lib/chatStorage';
import type { ChatStorageState } from './lib/chatStorage';
import {
  clearTrash,
  loadTrash,
  removeTrashEntries,
  saveTrash,
} from './lib/chatTrash';
import type { TrashEntry } from './lib/chatTrash';
import { FIND_IN_CONVERSATION_LABEL } from './lib/searchLabels';
import { DEFAULT_DRAFT_ID, sweepOrphanDrafts } from './lib/chatDrafts';
import {
  hasMinimalProfile,
  loadProfile,
  markOnboardingComplete,
  saveProfile,
} from './lib/profileStorage';
import {
  buildConversationJson,
  buildConversationMarkdown,
  conversationFilename,
  conversationJsonFilename,
  downloadJson,
  downloadMarkdown,
  exportableMessages,
} from './lib/exportConversation';
import { copyText } from './lib/clipboard';
import { CLEAR_ALL_LABEL } from './lib/copy';
import { buildChatRequestBody } from './lib/chatRequest';
import { createErrorToast, type ErrorToastState } from './lib/errorToast';
import {
  createClearAllUndo,
  type ClearAllUndoToastState,
} from './lib/clearAllUndo';
import {
  clearAllConfirmRequest,
  deleteConfirmRequest,
  describeConfirm,
  type ConfirmRequest,
} from './lib/confirmCopy';
import { pushInputHistory } from './lib/inputHistory';
import {
  isCollapsed,
  saveCollapsed,
  sidebarToggleLabel,
} from './lib/sidebarCollapse';
import { regeneratePromptFor } from './lib/regenerate';
import {
  collectPreviousReplies,
  isDuplicateReply,
} from './lib/regenerateDedupe';
import { toggleReplyVersion, versionSnapshotOf } from './lib/replyVersions';
import { canGenerateReply, pendingReplyPrompt } from './lib/pendingReply';
import { parseRateLimit, type RateLimitBudget } from './lib/rateLimitStatus';
import { isServiceDown } from './lib/serviceStatus';
import { headerStatusCopy } from './lib/headerStatus';
import { parseSseDataLine } from './lib/sse';
import { foldReplyDraft } from './lib/streamDraft';
import { canRunQuickPrompt } from './lib/quickPromptGate';
import {
  readReplyLengthPreference,
  replyLengthRequestField,
  writeReplyLengthPreference,
  type ReplyLengthPreference,
} from './lib/replyLength';
import { formatWaitingLabel, startWaitingTicker, tickIntervalMs } from './lib/thinkingTimer';
import {
  appendModelWaitHint,
  streamAnnouncement as buildStreamAnnouncement,
  toolPhaseLabel,
} from './lib/streamAnnouncement';
import { TOOL_LABELS, toolDisplayName } from './lib/toolLabels';
import './App.css';

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
  | { status: 'ok'; content: string }
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
  // P322: the sidebar needs to know an empty tools list is "still loading"
  // vs "fetch settled with nothing" — the former paints skeleton rows, the
  // latter falls back to the static entries.
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [health, setHealth] = useState<{ llmConfigured: boolean; llmModel?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  // P255: the profile dialog is opt-in now — a first-time visitor lands on
  // the chat surface with a usable composer instead of a form over it.
  // 「完善资料」 entries (welcome CTA, sidebar, post-reply nudge) open the
  // same dialog on demand: edit mode when a profile exists, the skippable
  // onboarding mode otherwise.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // P281: desktop collapse — the preference is read in the initial state so
  // the very first paint already lays out collapsed/expanded correctly and
  // nothing jumps after mount. The mobile drawer is a separate path.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isCollapsed());
  const [exportState, setExportState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [copyExportState, setCopyExportState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [jsonExportState, setJsonExportState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [language, setLanguage] = useState<ReplyLanguage>(() => readStoredLanguage());
  // P196: reply-length preference and the settings sheet it lives in.
  const [replyLength, setReplyLength] = useState<ReplyLengthPreference>(() =>
    readReplyLengthPreference(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // P227: open state for the narrow-header「更多操作」popover that holds the
  // three export/copy actions below the desktop breakpoint.
  const [moreOpen, setMoreOpen] = useState(false);
  // Stable identity: HeaderMoreMenu's dismiss effect depends on it, and a
  // fresh closure every render would refocus the first item mid-menu.
  const closeMoreMenu = useCallback(() => setMoreOpen(false), []);
  // P228: both destructive entries (sidebar 清空全部 / 删除对话 and the
  // settings 清空全部对话) funnel through this one confirm request.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  // P07: last known per-IP request budget, from chat response headers; stays
  // null until the first response so nothing is fabricated at startup.
  const [rateLimit, setRateLimit] = useState<RateLimitBudget | null>(null);
  const exportTimer = useRef<number | null>(null);
  const copyExportTimer = useRef<number | null>(null);
  const jsonExportTimer = useRef<number | null>(null);
  // P11: top banner for outage-class failures (network error or HTTP 5xx).
  const [serviceDownBanner, setServiceDownBanner] = useState(false);
  // P17: single-slot error toast — a fresh failure replaces it and restarts
  // the 8 s auto-dismiss window.
  const [errorToast, setErrorToast] = useState<ErrorToastState | null>(null);
  const [toastCtl] = useState(() => createErrorToast(setErrorToast));
  // P247: 清空全部 keeps a 6 s undo window — the snapshot lives in the
  // controller and the toast carries 撤销 back to storage if pressed in time.
  const [clearAllUndoToast, setClearAllUndoToast] =
    useState<ClearAllUndoToastState | null>(null);
  const [clearAllUndoCtl] = useState(() =>
    createClearAllUndo(setClearAllUndoToast),
  );
  // P265: the recycle bin — deleted sessions land here for 7 days, and the
  // single-row delete shares the undo-toast mechanics with its own copy.
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>(() =>
    loadTrash(),
  );
  const [trashUndoToast, setTrashUndoToast] =
    useState<ClearAllUndoToastState | null>(null);
  const [trashUndoCtl] = useState(() =>
    createClearAllUndo(setTrashUndoToast),
  );
  const [restoringSession, setRestoringSession] = useState(() => {
    const { activeSessionId, sessions } = loadChatState();
    const session = sessions.find((s) => s.id === activeSessionId);
    return Boolean(session && session.messages.length > 0);
  });
  const abortRef = useRef<AbortController | null>(null);
  // P206/P226: the header search toggle drives the in-conversation search
  // through this handle at every breakpoint.
  const chatWindowRef = useRef<ChatWindowHandle>(null);
  // P161: covers the frame between a 「生成回复」 click and the loading state
  // flush — a second click landing there must be a no-op.
  const replyInFlightRef = useRef(false);
  // P244: drafts submitted while a reply is in flight wait here and go out
  // automatically (FIFO) once the turn ends. Memory-only — a refresh drops
  // the queue rather than resurrecting a half-sent state.
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const pendingQueueRef = useRef<string[]>([]);
  const enqueuePending = useCallback((prompt: string) => {
    pendingQueueRef.current = [...pendingQueueRef.current, prompt];
    setPendingQueue(pendingQueueRef.current);
  }, []);
  // 「取消排队」 drops the queue without sending; the texts are returned so
  // the composer can restore them into the draft box.
  const cancelPendingQueue = useCallback((): string[] => {
    const dropped = pendingQueueRef.current;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    return dropped;
  }, []);
  const restoredRef = useRef(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { theme, toggle: toggleTheme, set: setTheme } = useTheme();
  // P154: browser connectivity — a dropped network surfaces a dim line above
  // the composer instead of only the generic P11 service banner.
  const online = useOnlineStatus();

  useEffect(() => {
    fetch('/api/tools')
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .catch(() => {})
      // P322: success, failure, or an empty payload all end the loading
      // state — the sidebar swaps its skeleton rows for real buttons (or
      // its static TOOL_FALLBACK entries) instead of skeletons forever.
      .finally(() => setToolsLoaded(true));

    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  // P159: drop draft keys orphaned by sessions deleted before draft purging
  // existed (or evicted by the session cap). DEFAULT_DRAFT_ID stays valid —
  // it holds the never-sent draft of a chat that has no session yet.
  useEffect(() => {
    const ids = loadChatState().sessions.map((s) => s.id);
    sweepOrphanDrafts([...ids, DEFAULT_DRAFT_ID]);
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
    if (!isMobile) {
      setSidebarOpen(false);
      setMoreOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    document.documentElement.lang = documentLangFor(language);
  }, [language]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // P196: while the settings sheet is open its own Escape handling wins —
      // closing the drawer too would inert the gear button the sheet returns
      // focus to.
      if (e.key === 'Escape' && !settingsOpen) setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, settingsOpen]);

  useEffect(
    () => () => {
      if (exportTimer.current !== null) window.clearTimeout(exportTimer.current);
      if (copyExportTimer.current !== null) window.clearTimeout(copyExportTimer.current);
      if (jsonExportTimer.current !== null) window.clearTimeout(jsonExportTimer.current);
      toastCtl.destroy();
      clearAllUndoCtl.destroy();
      trashUndoCtl.destroy();
    },
    [toastCtl, clearAllUndoCtl, trashUndoCtl],
  );

  // P156: the storage watcher below binds once on mount, so it reads the
  // streaming flag through a ref rather than re-subscribing on every change.
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // P253: runSend persists the just-sent message the moment it goes out,
  // before React commits the appended bubbles — a ref is the only way the
  // callback (which must not depend on `messages`) can read the settled
  // conversation to persist.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // P156: a write to the chat-history key from another tab fires `storage`
  // here — reload so the sidebar list and the open conversation match the
  // shared store. An in-flight stream is never interrupted; the refresh is
  // skipped instead of aborting the reply.
  // P250: the reload used to hand React a brand-new array on every event,
  // which re-fired the save effect and made two tabs write each other back
  // forever (~120 setItem/s). Each setter below now keeps its current
  // identity when the stored content is unchanged, so the loop has no
  // state change to feed on.
  useEffect(
    () =>
      watchChatStorage(() => {
        if (loadingRef.current) return;
        const next = activeChatFromState(loadChatState());
        const nextRecent = getRecentSessions();
        setRecentSessions((prev) =>
          sameRecentSessions(prev, nextRecent) ? prev : nextRecent,
        );
        // P265: a foreign delete/clear also moved its trash entries.
        setTrashEntries(loadTrash());
        setSessionId((prev) => (prev === next.sessionId ? prev : next.sessionId));
        setMessages((prev) =>
          sameConversation(prev, next.messages) ? prev : next.messages,
        );
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
   * P253: `requestSessionId` pins which backend session the turn targets —
   * runSend passes the id it just persisted under, which can be newer than
   * the `sessionId` this callback closed over.
   */
  const streamReply = useCallback(
    async (
      prompt: string,
      assistantId: string,
      requestSessionId: string | null = sessionId,
      // P284: versions the reply must not repeat — only 「换一个」 sends them.
      previousReplies?: string[],
    ): Promise<StreamOutcome> => {
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
          // P196: replyLength is omitted entirely at 默认 so an untouched
          // install sends byte-identical bodies.
          body: buildChatRequestBody({
            sessionId: requestSessionId,
            message: prompt,
            profile: profile ?? undefined,
            language,
            replyLength: replyLengthRequestField(replyLength),
            previousReplies,
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
        // P231: which stage of the tool lifecycle the wait copy describes.
        let toolPhase: ToolPhaseKind | undefined;
        let streamError: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            // P171: a malformed/injected line is skipped, not fatal — tokens
            // already accumulated survive and the stream keeps being read.
            const event = parseSseDataLine(line);
            if (event === null) continue;

            if (event.type === 'thinking') {
              streamPhase = 'thinking';
              // P284: a mid-stream thinking beat means the backend rejected
              // an echoed regen and is writing a replacement — drop the
              // duplicate draft so its deltas never stick to the new text.
              if (finalContent) {
                finalContent = '';
                patchAssistant({
                  content: '',
                  streamPhase,
                  streaming: true,
                  toolPhase: undefined,
                });
              } else {
                patchAssistant({ streamPhase, streaming: true });
              }
            }

            // P231: the backend announces the tool name the moment the
            // upstream tool_calls stream reveals it — before tool_start —
            // and again while its result is being written up. Either way
            // the bubble keeps a tool-named phase instead of going silent.
            if (event.type === 'tool_progress') {
              const d = event.data as { name?: string; phase?: string };
              toolPhase = d.phase === 'summarizing' ? 'summarizing' : 'calling';
              if (d.name && !toolEvents.some((t) => t.name === d.name)) {
                toolEvents.push({
                  name: d.name,
                  label: TOOL_LABELS[d.name] ?? d.name,
                  status: toolPhase === 'summarizing' ? 'done' : 'running',
                });
              }
              streamPhase = 'tool';
              patchAssistant({
                streamPhase,
                streaming: true,
                toolEvents: toolEvents.length ? [...toolEvents] : undefined,
                toolPhase,
              });
            }

            if (event.type === 'tool_start') {
              const d = event.data as { name: string };
              // A tool_progress 'calling' event may already have added the
              // badge — keep it running rather than pushing a duplicate.
              const existing = toolEvents.find((t) => t.name === d.name);
              if (existing) {
                existing.status = 'running';
              } else {
                toolEvents.push({
                  name: d.name,
                  label: TOOL_LABELS[d.name] ?? d.name,
                  status: 'running',
                });
              }
              toolPhase = 'calling';
              streamPhase = 'tool';
              patchAssistant({
                streamPhase,
                streaming: true,
                toolEvents: [...toolEvents],
                toolPhase,
              });
            }

            if (event.type === 'tool_end') {
              const d = event.data as { name: string; result: unknown };
              const idx = toolEvents.findIndex((t) => t.name === d.name && t.status === 'running');
              if (idx >= 0) {
                toolEvents[idx] = { ...toolEvents[idx], status: 'done', result: d.result };
              }
              const allDone = toolEvents.every((t) => t.status === 'done');
              // P231: all tools done means the result is being written up —
              // keep the tool name in the wait copy for that window too.
              toolPhase = allDone ? 'summarizing' : 'calling';
              streamPhase = allDone ? 'generating' : 'tool';
              patchAssistant({
                streamPhase,
                streaming: true,
                toolEvents: [...toolEvents],
                toolPhase,
              });
            }

            // P189: token increments grow the bubble while the model writes;
            // a later `message` still overwrites with the authoritative text.
            if (event.type === 'delta') {
              const folded = foldReplyDraft(finalContent, event);
              if (folded !== null) {
                finalContent = folded;
                streamPhase = 'generating';
                // P240: body text is arriving — drop the tool-named phase so
                // the wait copy returns to the generic generating label.
                toolPhase = undefined;
                patchAssistant({ content: finalContent, streamPhase, streaming: true, toolPhase });
              }
            }

            if (event.type === 'message') {
              const folded = foldReplyDraft(finalContent, event);
              if (folded !== null) {
                finalContent = folded;
                streamPhase = 'generating';
                toolPhase = undefined;
                patchAssistant({
                  content: finalContent,
                  streamPhase,
                  streaming: true,
                  toolPhase,
                  toolEvents: toolEvents.length ? [...toolEvents] : undefined,
                });
              }
            }

            if (event.type === 'done') {
              const d = event.data as {
                sessionId: string;
                tool?: string;
                tokens?: number;
                latencyMs?: number;
              };
              if (d.sessionId) {
                // P253: the turn was persisted under requestSessionId at
                // send time — if the backend ever reports a different id,
                // move the stored entry so the conversation keeps one id.
                if (requestSessionId && d.sessionId !== requestSessionId) {
                  remapChatSessionId(requestSessionId, d.sessionId);
                }
                setSessionId(d.sessionId);
              }
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
          toolPhase: undefined,
          toolEvents: toolEvents.length ? [...toolEvents] : undefined,
        });
        return { status: 'ok', content: finalContent };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // P12: user-initiated stop — keep whatever partial text arrived and
          // mark the bubble instead of raising an error. P169: when nothing
          // arrived at all, drop the placeholder so the trailing user bubble
          // re-offers P161's 「生成回复」 rather than a blank bubble. Either
          // way, skip the patch when the bubble is gone (session switched /
          // new chat while in flight).
          setMessages((prev) => {
            if (!prev.some((m) => m.id === assistantId)) return prev;
            if (!finalContent.trim()) {
              return prev.filter((m) => m.id !== assistantId);
            }
            return upsertAssistant(prev, assistantId, {
              content: finalContent,
              streaming: false,
              streamPhase: undefined,
              toolPhase: undefined,
              stopped: true,
              toolEvents: toolEvents.length ? [...toolEvents] : undefined,
            });
          });
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
    [profile, sessionId, language, replyLength],
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

  /**
   * Actually start a turn: append the user bubble + streaming placeholder
   * and run streamReply to completion. Never called while a turn is in
   * flight — the synchronous ref is the mutex (P224), so a queued drain or
   * a rapid double-submit can still only produce one turn at a time.
   */
  const runSend = useCallback(
    async (prompt: string) => {
      if (!prompt || replyInFlightRef.current) return;

      const now = Date.now();
      const assistantId = `a-${now}`;

      // P253: a brand-new chat used to have no session id until `done`
      // named one — too late to persist the user's own words. Mint the id
      // here (the backend adopts it) so the message lands in localStorage
      // at send time.
      const sid = sessionId ?? newSessionId();
      if (sessionId === null) setSessionId(sid);

      // P06/P168: the composer draft is already cleared; remember the message
      // for ArrowUp recall under this session's history (purely client-side,
      // best-effort localStorage).
      pushInputHistory(sid, prompt);
      const userMessage: ChatMessage = {
        id: `u-${now}`,
        role: 'user',
        content: prompt,
        createdAt: now,
      };
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: now,
          streaming: true,
          streamPhase: 'thinking',
        },
      ]);
      // P253: persist NOW, before the turn finishes — a refresh during
      // generation keeps the message. The streaming placeholder is never
      // part of the persisted list (serializeMessages drops it anyway).
      saveChatSession(sid, [...messagesRef.current, userMessage]);
      setRecentSessions(getRecentSessions());
      replyInFlightRef.current = true;
      setLoading(true);

      try {
        const outcome = await streamReply(prompt, assistantId, sid);
        noteStreamOutcome(outcome);
      } finally {
        replyInFlightRef.current = false;
        setLoading(false);
      }
    },
    [sessionId, streamReply, noteStreamOutcome],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt) return;
      // P224: `loading` only flips after React commits, so a second send
      // landing in the same tick used to slip past this check, enter
      // streamReply and abort() the in-flight stream (wiping both bubbles).
      // The synchronous ref closes that window — a turn in flight can only
      // be ended by the explicit 停止 button, never by another send.
      // P244: instead of dropping that send, park it in the pending queue —
      // the composer acknowledges it as 「已排队 N 条」 (P310). Queueing
      // while items are already waiting (even between turns) keeps strict
      // FIFO order.
      if (loading || replyInFlightRef.current || pendingQueueRef.current.length > 0) {
        enqueuePending(prompt);
        return;
      }
      await runSend(prompt);
    },
    [loading, runSend, enqueuePending],
  );

  // P244: a finished turn releases the next queued draft. The head is
  // shifted before dispatch so it can never re-enqueue itself; each run
  // drains exactly one item, so the queue always converges (no loop).
  useEffect(() => {
    if (loading || replyInFlightRef.current) return;
    const head = pendingQueueRef.current[0];
    if (head === undefined) return;
    pendingQueueRef.current = pendingQueueRef.current.slice(1);
    setPendingQueue(pendingQueueRef.current);
    void runSend(head);
  }, [loading, runSend]);

  /**
   * Re-run the failed turn. The user bubble is reused when it is still the one
   * right before the error, so retrying never duplicates the message in the
   * visible conversation (or in the transcript sent back to the API).
   */
  const handleRetry = useCallback(
    (messageId: string, prompt: string) => {
      if (loading || replyInFlightRef.current) return;

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
      replyInFlightRef.current = true;
      setLoading(true);
      void streamReply(prompt, assistantId)
        .then(noteStreamOutcome)
        .finally(() => {
          replyInFlightRef.current = false;
          setLoading(false);
        });
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
      if (loading || replyInFlightRef.current) return;
      const prompt = regeneratePromptFor(messages, messageId);
      if (!prompt) return;

      const target = messages[messages.length - 1];
      const original = versionSnapshotOf(target);
      // P284: the versions the new reply must not repeat — the text on screen
      // plus any parked P276 versions, sent along so the backend can steer
      // away from them and dedupe what still echoes back.
      const previousReplies = collectPreviousReplies(target);

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
        duplicateRegen: undefined,
        // P276: park the outgoing reply in the one-slot version store BEFORE
        // the stream overwrites the bubble — 「恢复上一版」 can then bring it
        // back. On failure P26 restores the same text, so the slot mirrors
        // the restored content and stays hidden behind the error UI.
        previousVersion: original,
        newerVersion: undefined,
      });
      replyInFlightRef.current = true;
      setLoading(true);
      void streamReply(prompt, messageId, undefined, previousReplies)
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
          } else if (
            outcome.status === 'ok' &&
            isDuplicateReply(original.content, outcome.content)
          ) {
            // P284: the stream "succeeded" but handed back the same reply —
            // put the shown version back and flag the honest 再试一次 line
            // instead of a fresh 约 X 秒 badge pretending the text changed.
            patchIfPresent({
              content: original.content,
              toolEvents: original.toolEvents,
              meta: original.meta,
              stopped: original.stopped,
              streaming: false,
              streamPhase: undefined,
              toolPhase: undefined,
              error: undefined,
              errorDetail: undefined,
              retryPrompt: undefined,
              previousVersion: undefined,
              newerVersion: undefined,
              duplicateRegen: true,
            });
          }
          patchIfPresent({ regenerating: undefined });
        })
        .finally(() => {
          replyInFlightRef.current = false;
          setLoading(false);
        });
    },
    [loading, messages, streamReply, noteStreamOutcome],
  );

  /**
   * P276: swap the displayed reply with the parked one on a regenerated
   * bubble. 恢复上一版 shows the outgoing version (newest parks in
   * newerVersion); 查看新版 swaps back. Pure state — no request is re-issued.
   */
  const handleToggleReplyVersion = useCallback((messageId: string) => {
    setMessages((prev) => toggleReplyVersion(prev, messageId));
  }, []);

  /**
   * P161: answer a restored conversation that ends on a bare user bubble —
   * its streamed reply was lost while the user message was already
   * persisted. Reuses the same streamReply path as the composer: only a
   * streaming assistant placeholder is appended, never a second user
   * bubble. The busy flag plus the in-flight ref keep rapid clicks to one
   * reply.
   */
  const handleGenerateReply = useCallback(() => {
    if (replyInFlightRef.current || !canGenerateReply(messages, loading)) return;
    const prompt = pendingReplyPrompt(messages);
    if (prompt === null) return;

    replyInFlightRef.current = true;
    const now = Date.now();
    const assistantId = `a-${now}`;
    setMessages((prev) => [
      ...prev,
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
    void streamReply(prompt, assistantId)
      .then(noteStreamOutcome)
      .finally(() => {
        replyInFlightRef.current = false;
        setLoading(false);
      });
  }, [loading, messages, streamReply, noteStreamOutcome]);

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

  // P255: the one 「完善资料」 entry path — a saved profile opens the edit
  // form, no profile opens the same dialog in its skippable onboarding mode.
  const openProfileDialog = () => {
    if (hasMinimalProfile(profile)) setEditingProfile(true);
    else setShowOnboarding(true);
  };

  // P316: a sidebar prompt entry (快捷入口 or 进阶工具) fills the composer
  // with a ready-to-edit draft — prefill only, the user still presses send.
  const handleQuickPrompt = (prompt: string) =>
    chatWindowRef.current?.prefillComposer(prompt);

  // P196: one setter shared by the header select and the settings sheet so
  // the i18n logic (state + persistence) stays in exactly one place.
  const applyLanguage = useCallback((next: ReplyLanguage) => {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // Storage unavailable — the choice still applies to this session.
    }
  }, []);

  const handleReplyLengthChange = useCallback((next: ReplyLengthPreference) => {
    setReplyLength(next);
    writeReplyLengthPreference(next);
  }, []);

  /** P12: abort the in-flight stream; the catch in streamReply finishes the turn. */
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Never leave a fetch running past unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // P192: the first visible token still takes 6–16 s (walkthrough evidence),
  // during which the bubble used to sit on a frozen placeholder. While a
  // reply is loading and nothing has streamed into it yet, tick an elapsed
  // counter once a second so the placeholder reads as progress. The first
  // delta/message fills content, done/error/abort end the turn, and unmount
  // runs the cleanup — all flip `waitingForFirstToken` and stop the ticker.
  const [waitingElapsedMs, setWaitingElapsedMs] = useState(0);
  const waitingForFirstToken =
    loading &&
    !messages.some((m) => m.role === 'assistant' && m.streaming && m.content);
  useEffect(() => {
    if (!waitingForFirstToken) {
      setWaitingElapsedMs(0);
      return;
    }
    const ticker = startWaitingTicker(() => {
      setWaitingElapsedMs((ms) => ms + tickIntervalMs());
    });
    return () => ticker.stop();
  }, [waitingForFirstToken]);
  // P210: the tool_start SSE event already lands in the bubble's toolEvents
  // with the same TOOL_LABELS mapping the badges use — the still-running
  // entry's label is what the wait copy names.
  const streamingMessage = messages.find((m) => m.streaming);
  const streamingPhase = streamingMessage?.streamPhase;
  const streamingToolPhase = streamingMessage?.toolPhase;
  // P240: the wait copy names the tool through the same P239 map — an
  // unmapped id falls back to the generic label, never the raw id.
  const runningToolName = streamingMessage?.toolEvents
    ?.filter((t) => t.status === 'running')
    .at(-1)?.name;
  const currentToolLabel =
    (runningToolName ? toolDisplayName(runningToolName) : undefined) ??
    // P231: while a finished tool's result is being written up there is no
    // running entry left — fall back to the last tool's label so the copy
    // keeps naming it.
    (streamingToolPhase === 'summarizing'
      ? toolDisplayName(streamingMessage?.toolEvents?.at(-1)?.name ?? '')
      : undefined);

  // P240/P252: past 8 s without a first body token the wait copy gains a
  // trailing 「还在等回复开始…」 clause — except while a tool call is still
  // running, whose named label already says what the wait is.
  const waitingLabel = waitingForFirstToken
    ? appendModelWaitHint(
        ((streamingPhase === 'tool' || streamingToolPhase === 'summarizing')
          ? toolPhaseLabel(currentToolLabel, waitingElapsedMs, streamingToolPhase)
          : undefined) ?? formatWaitingLabel(waitingElapsedMs),
        waitingElapsedMs,
        streamingToolPhase,
      )
    : undefined;

  const canExport = exportableMessages(messages).length > 0;

  // P179: exports are titled after the open conversation so multiple
  // downloads stay distinguishable — a rename wins, otherwise the title is
  // derived from the first user message the same way the sidebar does.
  const exportTitle = useCallback((): string => {
    const stored = sessionId
      ? getRecentSessions().find((s) => s.id === sessionId)
      : undefined;
    const custom = stored?.customTitle ? stored.title.trim() : '';
    return custom || sessionTitle(messages);
  }, [messages, sessionId]);

  const handleExport = useCallback(() => {
    const title = exportTitle();
    const now = Date.now();
    const markdown = buildConversationMarkdown(messages, { title, exportedAt: now });
    const ok = downloadMarkdown(markdown, conversationFilename(now, title));
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
  }, [messages, exportTitle]);

  /** P181: same export as Markdown but machine-readable — same bubbles,
   * same title/filename logic, same download plumbing. */
  const handleExportJson = useCallback(() => {
    const title = exportTitle();
    const now = Date.now();
    const json = buildConversationJson(messages, { title, exportedAt: now });
    const ok = downloadJson(json, conversationJsonFilename(now, title));
    setJsonExportState(ok ? 'done' : 'failed');
    if (jsonExportTimer.current !== null) window.clearTimeout(jsonExportTimer.current);
    jsonExportTimer.current = window.setTimeout(() => {
      setJsonExportState('idle');
      jsonExportTimer.current = null;
    }, 1500);
  }, [messages, exportTitle]);

  const handleCopyMarkdown = useCallback(async () => {
    const title = exportTitle();
    const markdown = buildConversationMarkdown(messages, { title });
    const ok = await copyText(markdown);
    setCopyExportState(ok ? 'done' : 'failed');
    if (copyExportTimer.current !== null) window.clearTimeout(copyExportTimer.current);
    copyExportTimer.current = window.setTimeout(() => {
      setCopyExportState('idle');
      copyExportTimer.current = null;
    }, 2000);
  }, [messages, exportTitle]);

  const closeSidebar = () => setSidebarOpen(false);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((v) => {
      saveCollapsed(!v);
      return !v;
    });
  };

  const streamAnnouncement = appendModelWaitHint(
    buildStreamAnnouncement(streamingPhase, waitingElapsedMs, currentToolLabel, streamingToolPhase),
    waitingElapsedMs,
    streamingToolPhase,
  );

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

  /** P228: the per-row delete only opens the confirm dialog; the deletion
   * itself happens in performDeleteChat after the danger button is pressed. */
  const handleDeleteChat = (id: string) => {
    // P265: a fresh destructive intent retires the pending clear-all toast —
    // the two undo windows share one visual slot.
    clearAllUndoCtl.dismiss();
    const title = recentSessions.find((s) => s.id === id)?.title ?? id;
    // P266: the message count is read from the store now so the dialog copy
    // cannot drift while it waits for an answer.
    setConfirmRequest(deleteConfirmRequest(loadChatState(), id, title));
  };

  /**
   * P148: delete one stored session. The backend DELETE is fire-and-forget —
   * the local copy is the source of truth for the list, and a dropped request
   * only leaves an idle backend session that the F01 TTL reaps anyway.
   * P265: the session moves into the 回收站 first (inside deleteChatSession),
   * and the delete arms the same 6 s undo window as 清空全部 — its 撤销 pulls
   * the entry back out of the trash.
   */
  const performDeleteChat = (id: string) => {
    const wasActive = id === sessionId;
    trashUndoCtl.confirm({
      takeSnapshot: loadChatState,
      message: '已移到回收站',
      wipe: () => {
        deleteChatSession(id);
        setRecentSessions(getRecentSessions());
        setTrashEntries(loadTrash());

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
      },
      restore: () => restoreDeletedChat(id, wasActive),
    });
  };

  /** P265: 撤销 on the single-delete toast — pull the entry back out of the
   * recycle bin and re-open the chat when it was the active one. */
  const restoreDeletedChat = (id: string, wasActive: boolean) => {
    const session = restoreChatSession(id);
    setRecentSessions(getRecentSessions());
    setTrashEntries(loadTrash());
    if (session && wasActive) {
      setSessionId(session.id);
      setMessages(session.messages);
      setActiveSessionId(session.id);
      setRestoringSession(true);
      void syncSessionWithBackend(
        session.id,
        session.messages,
        profile,
      ).finally(() => {
        setRestoringSession(false);
      });
    }
  };

  /** P265: the 回收站 panel's per-row 恢复 — the session rejoins 最近对话.
   * P268: restoring means 「接着聊」, so the restored conversation becomes the
   * active one and the mobile drawer folds away (ChatWindow's messages effect
   * scrolls the list to the latest bubble). */
  const handleRestoreTrash = (id: string) => {
    const session = restoreChatSession(id);
    setRecentSessions(getRecentSessions());
    setTrashEntries(loadTrash());
    if (!session) return;
    abortRef.current?.abort();
    toastCtl.dismiss();
    setSessionId(session.id);
    setMessages(session.messages);
    setActiveSessionId(session.id);
    setLoading(false);
    setRestoringSession(true);
    void syncSessionWithBackend(
      session.id,
      session.messages,
      profile,
    ).finally(() => {
      setRestoringSession(false);
    });
    closeSidebar();
  };

  /** P265: 清空回收站 — confirmed in-app, then the whole bin goes. */
  const handleClearTrash = () => {
    clearTrash();
    setTrashEntries([]);
  };

  /** P228: both 清空全部 triggers open the confirm dialog; the danger button
   * calls handleClearAllChats. */
  const requestClearAllChats = () =>
    // P266: same count-at-request-time capture as the single delete.
    setConfirmRequest(clearAllConfirmRequest(loadChatState()));

  /**
   * P247: the undo path — write the pre-clear snapshot back verbatim (same
   * session ids, titles, messages, active pointer) and point the chat
   * surface at the restored active conversation. The backend copies were
   * fire-and-forget deleted during the wipe, so the active session is
   * re-synced the same way handleSelectChat heals a missing one.
   */
  const restoreClearedChats = (snapshot: ChatStorageState) => {
    restoreChatState(snapshot);
    setRecentSessions(getRecentSessions());
    const active = activeChatFromState(snapshot);
    setSessionId(active.sessionId);
    setMessages(active.messages);
    if (active.sessionId) {
      setRestoringSession(true);
      void syncSessionWithBackend(
        active.sessionId,
        active.messages,
        profile,
      ).finally(() => {
        setRestoringSession(false);
      });
    }
  };

  /**
   * P155: wipe every stored session and reset the chat surface. The dialog
   * already confirmed, so reaching here always clears — messages, the
   * active id, and any stale banner/toast all reset to a clean empty chat.
   * P247: the controller snapshots the state being wiped first and arms
   * the 6 s undo toast, so the confirmation is no longer silent or final.
   */
  const handleClearAllChats = () => {
    clearAllUndoCtl.confirm({
      takeSnapshot: loadChatState,
      wipe: () => {
        // P265: retire the single-delete toast — the two undo windows share
        // one visual slot, and the new clear supersedes it.
        trashUndoCtl.dismiss();
        clearAllChatSessions();
        setRecentSessions([]);
        setTrashEntries(loadTrash());
        abortRef.current?.abort();
        toastCtl.dismiss();
        setServiceDownBanner(false);
        setMessages([]);
        setSessionId(null);
        setLoading(false);
        setRestoringSession(false);
        closeSidebar();
      },
      restore: restoreClearedChats,
      // P273: the wipe pushed these sessions into the recycle bin — undo
      // retracts exactly this clear's entries (older, unrelated ones stay)
      // so a bin 恢复 cannot duplicate a conversation undo just revived.
      removeTrash: (ids) => {
        saveTrash(removeTrashEntries(loadTrash(), ids));
        setTrashEntries(loadTrash());
      },
    });
  };

  /** P149: rename a stored session. Purely local — never touches the active
   * chat, and the next saveChatSession keeps the custom title. */
  const handleRenameChat = (id: string, title: string) => {
    renameChatSession(id, title);
    setRecentSessions(getRecentSessions());
  };

  const headerStatus = headerStatusCopy(health?.llmConfigured === true);
  // P312: the pristine first screen (no stored conversations AND no
  // messages) drops chrome that has nothing to act on — the header
  // export/copy buttons and the 顾问在线 status go with it; the sidebar
  // filter keys off its own empty list. Everything returns the moment a
  // conversation or a message exists.
  const isPristine = recentSessions.length === 0 && messages.length === 0;

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <span className="sr-only" role="status" aria-live="polite">
        {streamAnnouncement}
      </span>
      <Sidebar
        tools={tools}
        toolsLoading={!toolsLoaded}
        profile={profile}
        recentSessions={recentSessions}
        activeSessionId={sessionId}
        open={sidebarOpen}
        isMobile={isMobile}
        collapsed={sidebarCollapsed}
        onClose={closeSidebar}
        onQuickPrompt={(prompt) => {
          if (!canRunQuickPrompt(loading)) return;
          handleQuickPrompt(prompt);
          closeSidebar();
        }}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onClearAllChats={requestClearAllChats}
        trashEntries={trashEntries}
        onRestoreTrash={handleRestoreTrash}
        onClearTrash={handleClearTrash}
        busy={loading}
        pristine={isPristine}
        onEditProfile={() => {
          openProfileDialog();
          closeSidebar();
        }}
        onOpenSettings={() => setSettingsOpen(true)}
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
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        replyLength={replyLength}
        onReplyLengthChange={handleReplyLengthChange}
        language={language}
        onLanguageChange={applyLanguage}
        theme={theme}
        onThemeChange={setTheme}
        canExport={canExport}
        hasSessions={recentSessions.length > 0}
        busy={loading}
        onExportMarkdown={handleExport}
        onExportJson={handleExportJson}
        onClearAll={requestClearAllChats}
        llmModel={health?.llmModel}
      />
      <main className="main" id="main-content" tabIndex={-1}>
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
            {/* P281: the desktop collapse toggle lives in the header so it
                stays reachable while the sidebar is collapsed; the mobile
                breakpoint keeps its own 打开菜单 drawer button instead. */}
            {!isMobile && (
              <button
                type="button"
                className="sidebar-collapse-btn"
                aria-label={sidebarToggleLabel(sidebarCollapsed)}
                aria-expanded={!sidebarCollapsed}
                aria-controls="app-sidebar"
                title={sidebarToggleLabel(sidebarCollapsed)}
                onClick={toggleSidebarCollapse}
              >
                <svg
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
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M9 4v16" />
                  <path
                    d={
                      sidebarCollapsed ? 'M13 9l2.5 3-2.5 3' : 'M15.5 9l-2.5 3 2.5 3'
                    }
                  />
                </svg>
              </button>
            )}
            {/* P295: at 390px the wordmark ended up ellipsised to「Datin…」
                next to four controls — no width ever shows a fragment of
                the name again. Below the mobile breakpoint the brand is a
                logo-only mark that names itself through aria-label; the
                full title + subtitle still render at wider widths. */}
            <div
              className="header-title"
              role={isMobile ? 'img' : undefined}
              aria-label="DatingAgent"
            >
              <span className="logo" aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </span>
              {!isMobile && (
                <div className="header-title-text">
                  <h1>DatingAgent</h1>
                  <p className="subtitle">先听你说完，再给具体建议</p>
                </div>
              )}
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="theme-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? '当前：深色 · 点击切换浅色' : '当前：浅色 · 点击切换深色'}
            >
              <span className="theme-icon" aria-hidden="true">
                {theme === 'dark' ? (
                  <svg
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
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2" />
                    <path d="M12 21v2" />
                    <path d="M4.22 4.22l1.42 1.42" />
                    <path d="M18.36 18.36l1.42 1.42" />
                    <path d="M1 12h2" />
                    <path d="M21 12h2" />
                    <path d="M4.22 19.78l1.42-1.42" />
                    <path d="M18.36 5.64l1.42-1.42" />
                  </svg>
                ) : (
                  <svg
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
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
              </span>
            </button>
            {/* P206/P226: the in-conversation search trigger — inside the
                header it can never overlap a bubble, at every breakpoint
                (P226 moved the <1024px entry here too: the floating
                .search-toggle covered the first bubble at 390px). */}
            {!restoringSession && messages.length > 0 && (
              <button
                type="button"
                className="search-toggle-header"
                aria-label={FIND_IN_CONVERSATION_LABEL}
                title={FIND_IN_CONVERSATION_LABEL}
                onClick={() => chatWindowRef.current?.openSearch()}
              >
                <svg
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
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </button>
            )}
            {/* P227: below the desktop breakpoint the three low-frequency
                export/copy actions collapse into one「更多操作」popover,
                keeping the 390px row at <=5 controls with >=36px hit areas;
                >=768px still renders the same labelled buttons inline. */}
            <HeaderMoreMenu
              collapsed={isMobile}
              open={moreOpen}
              onToggle={() => setMoreOpen((v) => !v)}
              onClose={closeMoreMenu}
            >
              {/* P295: the reply-language picker folds into「更多操作」on
                  narrow screens as the menu's first row (a labelled group,
                  not a menuitem); on the wide header it still renders
                  inline inside .header-actions. */}
              <label
                className="lang-select"
                role="group"
                aria-label="回复语言"
                title="选择回复语言（自动跟随对话）"
              >
                <span className="lang-select-icon" aria-hidden="true">
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
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </span>
                <span className="lang-select-caption">回复语言</span>
                <select
                  className="lang-select-input"
                  value={language}
                  onChange={(e) => applyLanguage(e.target.value as ReplyLanguage)}
                  aria-label="回复语言"
                  title="回复语言（只影响 AI 回复的语言，界面保持中文）"
                >
                  <option value="auto">自动</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              {!isPristine && (
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
                <span className="btn-icon" aria-hidden="true">
                  {exportState === 'done' ? (
                    '✓'
                  ) : (
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
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                  )}
                </span>
                <span className="btn-label">
                  {exportState === 'done'
                    ? '已导出'
                    : exportState === 'failed'
                      ? '导出失败'
                      : '导出 Markdown'}
                </span>
              </button>
              )}
              {!isPristine && (
              <button
                type="button"
                className={`export-json-btn${jsonExportState === 'done' ? ' done' : ''}${
                  jsonExportState === 'failed' ? ' failed' : ''
                }`}
                onClick={handleExportJson}
                disabled={!canExport}
                aria-label={
                  jsonExportState === 'done'
                    ? '已导出'
                    : jsonExportState === 'failed'
                      ? '导出失败'
                      : '导出 JSON'
                }
                title={
                  canExport
                    ? '把当前对话导出为 JSON 文件'
                    : jsonExportState === 'failed'
                      ? '导出失败，请稍后重试'
                      : '暂无内容可导出'
                }
              >
                <span className="btn-icon" aria-hidden="true">
                  {jsonExportState === 'done' ? (
                    '✓'
                  ) : (
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
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                  )}
                </span>
                <span className="btn-label">
                  {jsonExportState === 'done'
                    ? '已导出'
                    : jsonExportState === 'failed'
                      ? '导出失败'
                      : '导出 JSON'}
                </span>
              </button>
              )}
              {!isPristine && (
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
                <span className="btn-icon" aria-hidden="true">
                  {copyExportState === 'done' ? (
                    '✓'
                  ) : (
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
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </span>
                <span className="btn-label">
                  {copyExportState === 'done'
                    ? '已复制'
                    : copyExportState === 'failed'
                      ? '复制失败'
                      : '复制 Markdown'}
                </span>
              </button>
              )}
            </HeaderMoreMenu>
            <span className="export-status" role="status" aria-live="polite">
              {copyExportState === 'done'
                ? '已复制到剪贴板'
                : copyExportState === 'failed'
                  ? '复制失败'
                  : exportState === 'done'
                    ? '已下载 Markdown 文件'
                    : exportState === 'failed'
                      ? '导出失败'
                      : jsonExportState === 'done'
                        ? '已下载 JSON 文件'
                        : jsonExportState === 'failed'
                          ? '导出失败'
                          : ''}
            </span>
            {/* P312: on the pristine first screen the status line has no
                conversation to speak for — it returns with the chrome. */}
            {!isPristine && (
              <div
                className="header-status"
                role="status"
                aria-live="polite"
                title={headerStatus.detail}
                aria-label={headerStatus.detail}
              >
                <span
                  className={`status-dot ${health?.llmConfigured ? 'live' : 'mock'}`}
                  aria-hidden="true"
                />
                {headerStatus.label}
              </div>
            )}
          </div>
        </header>
        <ServiceBanner
          visible={serviceDownBanner}
          retrying={loading}
          onRetry={handleServiceRetry}
          onDismiss={() => setServiceDownBanner(false)}
        />
        <ChatWindow
          ref={chatWindowRef}
          messages={messages}
          loading={loading}
          waitingLabel={waitingLabel}
          restoring={restoringSession}
          profile={profile}
          sessionId={sessionId}
          onSend={sendMessage}
          onStop={stopStreaming}
          onRetry={handleRetry}
          onRegenerate={handleRegenerate}
          onToggleReplyVersion={handleToggleReplyVersion}
          onGenerateReply={handleGenerateReply}
          onSetupProfile={openProfileDialog}
          rateLimit={rateLimit}
          offline={!online}
          errorToast={errorToast}
          onToastRetry={handleToastRetry}
          onToastDismiss={toastCtl.dismiss}
          replyLength={replyLength}
          onReplyLengthChange={handleReplyLengthChange}
          queuedCount={pendingQueue.length}
          onCancelQueue={cancelPendingQueue}
        />
        <SystemStatusFooter />
      </main>
      {clearAllUndoToast && (
        <UndoToast
          text={clearAllUndoToast.message}
          actionLabel={clearAllUndoToast.actionLabel}
          onAction={clearAllUndoCtl.undo}
          onDismiss={clearAllUndoCtl.dismiss}
        />
      )}
      {trashUndoToast && (
        <UndoToast
          text={trashUndoToast.message}
          actionLabel={trashUndoToast.actionLabel}
          onAction={trashUndoCtl.undo}
          onDismiss={trashUndoCtl.dismiss}
        />
      )}
      {confirmRequest && (
        <ConfirmDialog
          title={
            confirmRequest.kind === 'clear-all' ? CLEAR_ALL_LABEL : '删除对话'
          }
          description={describeConfirm(confirmRequest)}
          confirmLabel={confirmRequest.kind === 'clear-all' ? '清空全部' : '删除'}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            const request = confirmRequest;
            setConfirmRequest(null);
            if (request.kind === 'clear-all') handleClearAllChats();
            else performDeleteChat(request.sessionId);
          }}
        />
      )}
    </div>
  );
}
