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

# 一键部署脚本（构建、端口检查、健康探测）
bash scripts/deploy.sh
```

- 前端开发：http://localhost:3000
- 后端 API：http://localhost:3001/api/health
- 生产模式：后端同时 serve 前端静态文件

### 健康检查

`GET /api/health` 返回运行状态、uptime、内存占用、LLM 是否配置，以及 `frontend/dist` 是否已构建：

```json
{
  "status": "ok",
  "uptimeSeconds": 42,
  "memory": { "rssMb": 55.2, "heapUsedMb": 12.1, "heapTotalMb": 18.0 },
  "llmConfigured": false,
  "frontend": { "built": true, "indexExists": true }
}
```

若前端未构建，`status` 为 `degraded` 且 HTTP 503。

### systemd 部署

1. 将项目安装到 `/opt/dating-agent`（或修改 unit 中的路径）
2. 复制并编辑 service 文件：

```bash
sudo cp scripts/dating-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dating-agent
sudo systemctl status dating-agent
```

3. 环境变量放在 `/opt/dating-agent/.env`（参考 `.env.example`）
4. 日志默认追加到 `/var/log/dating-agent.log`；轮转配置见 `scripts/dating-agent.logrotate`

启动时后端会校验 `PORT` 与可选 LLM 变量，并在日志中输出清晰提示（mock 模式 vs live LLM）。

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

## Ralph Loop (Cursor)

Use the [Ralph Loop](https://github.com/deepseek-ai/deepseek-harness) pattern to drive multi-round work with **fresh agent context** each round. Workspace files (including `.ralph/`) are the shared memory; only a bounded handoff crosses round boundaries.

### In Cursor IDE

Skill path: `~/.cursor/skills/ralph` (see `SKILL.md` for full workflow).

```text
/ralph <objective>
/ralph <objective> --max-rounds 8
```

The orchestrator creates `.ralph/state.json`, spawns a fresh **ralph-worker** each round, and reads `.ralph/handoff.json` to decide whether to continue, stop, or surface a blocker.

### Headless CLI

Requires `cursor-agent` (logged in) and `jq`:

```bash
~/.cursor/skills/ralph/scripts/ralph-loop.sh "<objective>" [max_rounds] [workspace]
```

Example from this repo:

```bash
~/.cursor/skills/ralph/scripts/ralph-loop.sh "Add feature X and verify health" 8 /root/DatingAgent
```

Defaults: 8 rounds max, current directory as workspace. Exit codes: `0` complete, `1` blocked/worker error, `2` budget exhausted.

### Handoff file

Each worker round writes `.ralph/handoff.json`:

```json
{
  "status": "continue | complete | blocked",
  "summary": "What this round accomplished",
  "evidence": ["paths, command output, URLs"],
  "nextSteps": ["concrete next actions"],
  "blocker": ""
}
```

- `continue` — more rounds needed (`nextSteps` required)
- `complete` — objective done (`evidence` required)
- `blocked` — cannot proceed (`blocker` required)

## License

MIT
