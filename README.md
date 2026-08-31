# DatingAgent

AI 恋爱关系顾问 — 基于 Agent Harness 架构的 TypeScript 全栈项目。

> 面试友好版：强调 Agent 工程能力（Tool-calling Loop、SSE 流式、会话管理），而非「话术套路」。

## 架构

```
┌─────────────┐     SSE/REST      ┌──────────────────────────────────┐
│  React UI   │ ◄──────────────► │  Express API (port 3001)          │
│  (port 3000)│                   │  ┌────────────────────────────┐  │
└─────────────┘                   │  │  AgentHarness              │  │
                                  │  │  ├─ LLM Client (OpenAI)    │  │
                                  │  │  ├─ Tool Registry (5 tools)│  │
                                  │  │  └─ Session Store          │  │
                                  │  └────────────────────────────┘  │
                                  └──────────────────────────────────┘
```

### Agent 工具

| 工具 | 功能 |
|------|------|
| `analyze_profile` | 交友资料优化分析 |
| `coach_conversation` | 聊天回复指导 |
| `plan_date` | 约会方案规划 |
| `check_compatibility` | 关系匹配度分析 |
| `get_relationship_advice` | 通用关系建议 |

## 快速开始

```bash
# 安装依赖
npm install

# 配置 LLM（可选，不配置则 Demo 模式）
cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY

# 开发模式（前后端同时启动）
npm run dev

# 生产构建 & 部署
npm run build
npm run start
```

- 前端开发：http://localhost:3000
- 后端 API：http://localhost:3001/api/health
- 生产模式：后端同时 serve 前端静态文件

## 技术栈

- **Backend**: TypeScript, Express, Agent Harness (tool-calling loop)
- **Frontend**: React 19, Vite, SSE streaming
- **LLM**: OpenAI-compatible API（支持 DeepSeek、OpenAI 等）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端端口 | `3001` |
| `OPENAI_API_KEY` | LLM API Key | 空（Demo 模式） |
| `LLM_BASE_URL` | API 地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型 | `gpt-4o-mini` |

## License

MIT
