# DEVLOG — autonomous feature loop

<!-- one line per run: YYYY-MM-DD HH:MM | F0X | what changed -->
2026-11-14 | setup | LLM switched to jinshu's Aliyun key (qwen3.8-flash); deploy/rollback scripts + backlog created
2026-11-14 11:53 | F01 | session store now tracks lastActiveAt: GET /api/sessions {count,oldestAgeSec}, DELETE /api/session/:id {deleted}, 30min idle TTL + 500-session cap with LRU trim
