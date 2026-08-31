import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ChatMessage, ToolEvent, ToolInfo } from './types';
import ChatWindow from './components/ChatWindow';
import Sidebar from './components/Sidebar';
import './App.css';

const TOOL_LABELS: Record<string, string> = {
  analyze_profile: '资料优化',
  coach_conversation: '聊天指导',
  plan_date: '约会规划',
  check_compatibility: '匹配分析',
  get_relationship_advice: '关系建议',
};

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [health, setHealth] = useState<{ llmConfigured: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      const assistantId = `a-${Date.now()}`;
      const toolEvents: ToolEvent[] = [];

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: text.trim() }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6)) as AgentEvent;

            if (event.type === 'tool_start') {
              const d = event.data as { name: string };
              toolEvents.push({
                name: d.name,
                label: TOOL_LABELS[d.name] ?? d.name,
                status: 'running',
              });
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== assistantId),
                {
                  id: assistantId,
                  role: 'assistant',
                  content: finalContent || '正在调用工具…',
                  toolEvents: [...toolEvents],
                },
              ]);
            }

            if (event.type === 'tool_end') {
              const d = event.data as { name: string; result: unknown };
              const idx = toolEvents.findIndex((t) => t.name === d.name && t.status === 'running');
              if (idx >= 0) {
                toolEvents[idx] = { ...toolEvents[idx], status: 'done', result: d.result };
              }
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== assistantId),
                {
                  id: assistantId,
                  role: 'assistant',
                  content: finalContent || '分析完成，正在生成回复…',
                  toolEvents: [...toolEvents],
                },
              ]);
            }

            if (event.type === 'message') {
              finalContent = (event.data as { content: string }).content;
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== assistantId),
                {
                  id: assistantId,
                  role: 'assistant',
                  content: finalContent,
                  toolEvents: toolEvents.length ? [...toolEvents] : undefined,
                },
              ]);
            }

            if (event.type === 'done') {
              const sid = (event.data as { sessionId: string }).sessionId;
              if (sid) setSessionId(sid);
            }

            if (event.type === 'error') {
              finalContent = `出错了：${(event.data as { message: string }).message}`;
            }
          }
        }

        if (!finalContent) {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== assistantId),
            { id: assistantId, role: 'assistant', content: '暂无回复，请重试。' },
          ]);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: `请求失败：${(err as Error).message}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId],
  );

  const handleQuickPrompt = (prompt: string) => sendMessage(prompt);

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setLoading(false);
  };

  return (
    <div className="app">
      <Sidebar tools={tools} onQuickPrompt={handleQuickPrompt} onNewChat={handleNewChat} />
      <main className="main">
        <header className="header">
          <div className="header-title">
            <span className="logo">🌹</span>
            <div>
              <h1>DatingAgent</h1>
              <p className="subtitle">AI 恋爱关系顾问 · Agent Harness</p>
            </div>
          </div>
          <div className="header-status">
            <span className={`status-dot ${health?.llmConfigured ? 'live' : 'mock'}`} />
            {health?.llmConfigured ? 'LLM 已连接' : 'Demo 模式'}
          </div>
        </header>
        <ChatWindow messages={messages} loading={loading} onSend={sendMessage} />
      </main>
    </div>
  );
}
