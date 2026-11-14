# DatingAgent — Feature Backlog

Operating contract for the autonomous feature loop: see `docs/AGENT-LOOP.md`.
**Rule: one unchecked item per run, top-down. Tick it only after `scripts/ci-deploy.sh` exits 0.**

- [ ] **F01 · Session lifecycle** — `GET /api/sessions` returns `{count, oldestAgeSec}` (no PII), `DELETE /api/session/:id` → `{deleted:true|false}`, plus idle-TTL eviction (30 min) and a 500-session cap in `routes/app.ts`. Acceptance: created session disappears after `DELETE`; `GET /api/session/:id` then 404s; health still 200.
- [ ] **F02 · Input guardrails** — `POST /api/chat` and `/api/chat/stream`: message > 4000 chars → 413 JSON `{error}`; per-IP rate limit 30 req/min → 429 with `Retry-After`. Acceptance: oversized body 413, burst > 30 → 429, normal chat still 200.
- [ ] **F03 · Graceful shutdown** — handle SIGTERM/SIGINT: stop accepting connections, `server.close()`, exit 0 with a log line. Acceptance: `pm2 restart` leaves no `EADDRINUSE` and health 200 after.
- [ ] **F04 · Build info endpoint** — `GET /api/version` → `{version, gitSha, buildTime, node}`; git sha/buildTime injected at build (env or generated file), never read at request time.
- [ ] **F05 · Structured request logging** — middleware logging `{ts, id, method, path, status, ms, msgLen}` as JSON lines. No message content, no keys.
- [ ] **F06 · Copy reply button** — clipboard copy on assistant bubbles with a 1.5 s "copied" affordance; graceful fallback when `navigator.clipboard` is unavailable.
- [ ] **F07 · Export conversation** — "导出 Markdown" action downloads the current conversation as `.md` (role headings + timestamps).
- [ ] **F08 · Theme toggle** — light/dark toggle persisted in `localStorage`, defaults to `prefers-color-scheme`, no flash of wrong theme.
- [ ] **F09 · Retry last message** — when a chat request errors, show "重试" that resends the last user message without duplicating history.
- [ ] **F10 · Keyboard shortcuts** — `Ctrl/Cmd+Enter` send, `Esc` blur input, `Shift+Enter` newline; documented in a tooltip.
- [ ] **F11 · Reply language switch** — optional `language: "zh" | "en" | "auto"` on `/api/chat`, appended as a directive to the system prompt; `auto` keeps current behaviour.
- [ ] **F12 · Test suite** — add `vitest` at the repo root with tests for `tools/registry.ts` (unknown tool → error), `lib/health.ts` (missing dist → `degraded`), and harness tool-loop dispatch. Add `npm test`.
- [ ] **F13 · README API reference** — endpoint table + copy-paste `curl` examples, kept under 40 lines added.
- [ ] **F14 · Usage metrics** — count requests/tokens/avg latency in memory and expose them on `/api/health` under `metrics`; no persistence.
- [ ] **F15 · Accessibility pass** — `aria-label`s on icon buttons, visible focus rings, `prefers-reduced-motion` guard for the streaming animation.

## Done

<!-- Move completed items here with the commit sha. -->
