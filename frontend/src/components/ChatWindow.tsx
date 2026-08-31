import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import MessageBubble from './MessageBubble';
import InputBar from './InputBar';
import './ChatWindow.css';

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
}

export default function ChatWindow({ messages, loading, onSend }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="chat-window">
      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-icon">🌹</div>
            <h2>你好，我是 DatingAgent</h2>
            <p>专业的 AI 恋爱关系顾问，基于 Agent Harness 架构驱动。</p>
            <div className="welcome-features">
              <div className="feature">
                <span>🔧</span>
                <div>
                  <strong>Tool-calling Loop</strong>
                  <p>自动调用专业工具分析你的问题</p>
                </div>
              </div>
              <div className="feature">
                <span>💬</span>
                <div>
                  <strong>真诚沟通</strong>
                  <p>拒绝 PUA 套路，倡导共情与边界感</p>
                </div>
              </div>
              <div className="feature">
                <span>📊</span>
                <div>
                  <strong>结构化输出</strong>
                  <p>资料优化、聊天指导、约会规划一应俱全</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {loading && messages[messages.length - 1]?.role === 'user' && (
          <div className="typing">
            <span /><span /><span />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputBar onSend={onSend} disabled={loading} />
    </div>
  );
}
