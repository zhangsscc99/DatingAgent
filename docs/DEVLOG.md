# DEVLOG — autonomous feature loop

<!-- one line per run: YYYY-MM-DD HH:MM | F0X | what changed -->
2026-11-14 | setup | LLM switched to jinshu's Aliyun key (qwen3.8-flash); deploy/rollback scripts + backlog created
2026-11-14 11:53 | F01 | session store now tracks lastActiveAt: GET /api/sessions {count,oldestAgeSec}, DELETE /api/session/:id {deleted}, 30min idle TTL + 500-session cap with LRU trim
2026-11-14 12:13 | F02 | lib/guardrails.ts: 4000-char message cap (413 JSON on /api/chat + /api/chat/stream), per-IP 30 req/min fixed-window limiter (429 + Retry-After + X-RateLimit-*), JSON body-parse errors; frontend maxLength + counter and readable 413/429 messages
