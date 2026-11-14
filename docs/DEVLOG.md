# DEVLOG — autonomous feature loop

<!-- one line per run: YYYY-MM-DD HH:MM | F0X | what changed -->
2026-11-14 | setup | LLM switched to jinshu's Aliyun key (qwen3.8-flash); deploy/rollback scripts + backlog created
2026-11-14 11:53 | F01 | session store now tracks lastActiveAt: GET /api/sessions {count,oldestAgeSec}, DELETE /api/session/:id {deleted}, 30min idle TTL + 500-session cap with LRU trim
2026-11-14 12:13 | F02 | lib/guardrails.ts: 4000-char message cap (413 JSON on /api/chat + /api/chat/stream), per-IP 30 req/min fixed-window limiter (429 + Retry-After + X-RateLimit-*), JSON body-parse errors; frontend maxLength + counter and readable 413/429 messages
2026-11-14 12:18 | F03 | index.ts graceful shutdown: SIGTERM/SIGINT stop the listener, closeIdleConnections, in-flight requests drain via server.close(), exit 0 with a log line, 8s force-exit guard; verified both signals exit cleanly and pm2 restart leaves no EADDRINUSE (health 200 after)
2026-11-14 12:30 | F04 | GET /api/version -> {version,gitSha,buildTime,node}: scripts/gen-build-info.mjs writes gitignored backend/src/generated/build-info.ts before tsc (GIT_SHA/BUILD_TIME overridable), lib/version.ts serves constants with no per-request git/file I/O; health reports the same version
2026-11-14 12:42 | F05 | lib/request-log.ts: per-request JSON access log {ts,id,method,path,status,ms,msgLen} on stdout via finish+close (aborted requests included), registered before express.json so 400/413 parser failures are logged too; query strings stripped, message text never logged (msgLen only), X-Request-Id response header; verified 200/413(msgLen 4001)/400 lines and zero message-content lines in the pm2 out log
