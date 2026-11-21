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

`GET /api/health` 返回运行状态、uptime、内存占用、LLM 是否配置，以及 `frontend/dist` 是否已构建，另附进程内累计的 `metrics`（重启即清零，不落盘）：

```json
{
  "status": "ok",
  "service": "DatingAgent",
  "version": "1.0.0",
  "uptimeSeconds": 42,
  "node": "v24.5.0",
  "memory": { "rssMb": 55.2, "heapUsedMb": 12.1, "heapTotalMb": 18.0 },
  "llmConfigured": false,
  "llmModel": "gpt-4o-mini",
  "frontend": { "distPath": "/www/DatingAgent/frontend/dist", "built": true, "indexExists": true },
  "metrics": {
    "requests": { "total": 12, "chat": 3, "chatErrors": 0 },
    "tokens": { "prompt": 1840, "completion": 512, "total": 2352 },
    "latency": { "chatSamples": 3, "avgMs": 1420.5, "lastMs": 980, "maxMs": 2100 },
    "startedAt": "2026-11-15T18:37:01.062Z",
    "rssMB": 55
  }
}
```

`metrics` 字段说明（全部为进程内累计值，仅驻留内存，重启即清零，从不落盘）：

- `metrics.requests.total` — 进程启动以来收到的请求总数
- `metrics.requests.chat` — `/api/chat*` 请求数
- `metrics.requests.chatErrors` — chat 请求出错次数
- `metrics.tokens.prompt` — LLM prompt token 累计数
- `metrics.tokens.completion` — LLM completion token 累计数
- `metrics.tokens.total` — prompt + completion 合计
- `metrics.latency.chatSamples` — 计入延迟统计的 chat 请求数
- `metrics.latency.avgMs` — chat 平均延迟（毫秒）
- `metrics.latency.lastMs` — 最近一次 chat 延迟（毫秒）
- `metrics.latency.maxMs` — chat 最大延迟（毫秒）
- `metrics.startedAt` — 进程启动时间（ISO 8601 时间戳）
- `metrics.rssMB` — 进程当前 RSS 内存（MB，取整）

若前端未构建或 LLM 未配置（`llmConfigured: false`），`status` 为 `degraded` 且 HTTP 503；`degradedReason` 标明原因（`frontend-dist` 优先于 `llm`），健康时为 `null`。

## API

生产实例（pm2 `dating-agent`）监听 `3012`，下文用 `BASE` 指代；本地开发默认 `3001`。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 状态、uptime、`node` 运行时版本、内存、LLM 配置与 `llmModel`、前端构建、`metrics` 用量；`degraded` → 503 |
| — | `/api/health` 字段 `node` | Node 运行时版本（`process.version`，如 `v24.5.0`），用于免 SSH 确认运行时 |
| — | `/api/health` 字段 `degradedReason` | `degraded` 原因：`frontend-dist`（前端未构建，两者同时命中时优先）或 `llm`（LLM 未配置）；`status: ok` 时为 `null` |
| GET | `/api/version` | `{version, gitSha, buildTime, node}`，构建期注入 |
| GET | `/api/tools` | 工具列表 `{name, label, icon, inputs}`（`inputs` 为各工具参数 schema） |
| GET | `/api/sessions` | `{count, oldestAgeSec}`，不含内容与 PII |
| POST | `/api/session` | body `{profile?}` → `{sessionId}` |
| POST | `/api/session/restore` | body `{sessionId, messages?, profile?}` → `{sessionId, restored, messageCount}` |
| GET | `/api/session/:id` | `{sessionId, profile, history}`，不存在 404 |
| DELETE | `/api/session/:id` | `{deleted: true\|false}` |
| POST | `/api/chat` | body `{sessionId?, message, profile?, language?}` → `{sessionId, reply, language}` |
| POST | `/api/chat/stream` | 同上，SSE 事件 `thinking`/`tool_start`/`tool_end`/`message`/`error`/`done` |

限制：`message` 超过 4000 字符 → 413；`/api/chat*` 每 IP 30 次/分钟 → 429（带 `Retry-After`）；`language` 仅接受 `zh`/`en`/`auto`，其它值 400。

```bash
BASE=http://localhost:3012

curl -s $BASE/api/health
curl -s -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"他三天没回我消息，怎么办？","language":"zh"}'
curl -sN -X POST $BASE/api/chat/stream -H 'Content-Type: application/json' \
  -d '{"message":"帮我看看交友资料","language":"auto"}'
curl -s -X DELETE $BASE/api/session/<sessionId>
```

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
