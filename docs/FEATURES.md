# DatingAgent — Feature Backlog

Operating contract for the autonomous feature loop: see `docs/AGENT-LOOP.md`.
**Rule: one unchecked item per run, top-down. Tick it only after `scripts/ci-deploy.sh` exits 0.**

- [x] **F01 · Session lifecycle** — `GET /api/sessions` returns `{count, oldestAgeSec}` (no PII), `DELETE /api/session/:id` → `{deleted:true|false}`, plus idle-TTL eviction (30 min) and a 500-session cap in `routes/app.ts`. Acceptance: created session disappears after `DELETE`; `GET /api/session/:id` then 404s; health still 200.
- [x] **F02 · Input guardrails** — `POST /api/chat` and `/api/chat/stream`: message > 4000 chars → 413 JSON `{error}`; per-IP rate limit 30 req/min → 429 with `Retry-After`. Acceptance: oversized body 413, burst > 30 → 429, normal chat still 200.
- [x] **F03 · Graceful shutdown** — handle SIGTERM/SIGINT: stop accepting connections, `server.close()`, exit 0 with a log line. Acceptance: `pm2 restart` leaves no `EADDRINUSE` and health 200 after.
- [x] **F04 · Build info endpoint** — `GET /api/version` → `{version, gitSha, buildTime, node}`; git sha/buildTime injected at build (env or generated file), never read at request time.
- [x] **F05 · Structured request logging** — middleware logging `{ts, id, method, path, status, ms, msgLen}` as JSON lines. No message content, no keys.
- [x] **F06 · Copy reply button** — clipboard copy on assistant bubbles with a 1.5 s "copied" affordance; graceful fallback when `navigator.clipboard` is unavailable.
- [x] **F07 · Export conversation** — "导出 Markdown" action downloads the current conversation as `.md` (role headings + timestamps).
- [x] **F08 · Theme toggle** — light/dark toggle persisted in `localStorage`, defaults to `prefers-color-scheme`, no flash of wrong theme.
- [x] **F09 · Retry last message** — when a chat request errors, show "重试" that resends the last user message without duplicating history.
- [x] **F10 · Keyboard shortcuts** — `Ctrl/Cmd+Enter` send, `Esc` blur input, `Shift+Enter` newline; documented in a tooltip.
- [x] **F11 · Reply language switch** — optional `language: "zh" | "en" | "auto"` on `/api/chat`, appended as a directive to the system prompt; `auto` keeps current behaviour.
- [x] **F12 · Test suite** — add `vitest` at the repo root with tests for `tools/registry.ts` (unknown tool → error), `lib/health.ts` (missing dist → `degraded`), and harness tool-loop dispatch. Add `npm test`.
- [x] **F13 · README API reference** — endpoint table + copy-paste `curl` examples, kept under 40 lines added.
- [x] **F14 · Usage metrics** — count requests/tokens/avg latency in memory and expose them on `/api/health` under `metrics`; no persistence.
- [x] **F15 · Accessibility pass** — `aria-label`s on icon buttons, visible focus rings, `prefers-reduced-motion` guard for the streaming animation.

## Sprint 2 (seeded 2026-11-14)

- [ ] **F16 · Fix stale /api/version sha** — `gitSha` currently reports the *previous* commit because `ci-deploy.sh` builds before the loop commits. Generate build-info after commit, or have ci-deploy re-run `node scripts/gen-build-info` + rebuild only the backend after commit. Acceptance: `/api/version` gitSha == `git rev-parse --short HEAD` on a clean tree.
- [ ] **F17 · Tool input schemas in /api/tools** — expose each tool's parameter names/types (derive from the zod schemas in `tools/registry.ts`) so the UI can show what each tool needs. Acceptance: `/api/tools` returns `inputs` per tool; no schema duplication.
- [ ] **F18 · Control-character sanitisation** — strip NUL/ESC and other control chars from `message` before it reaches the LLM; keep newlines/tabs. Acceptance: `\u0000`-laden message returns 200 and the log line stays single-line valid JSON.
- [ ] **F19 · SSE keepalive** — send a `: ping` comment every 15 s on `/api/chat/stream` while the model is thinking, so proxies don't drop idle connections. Acceptance: a deliberately slow tool still streams to completion through a 30 s window.
- [ ] **F20 · Empty-state prompt chips** — when a conversation has no messages, show 3 tappable starter prompts (资料优化 / 聊天指导 / 约会规划) that prefill the composer. Acceptance: chip click fills the input, sends, and disappears after the first message.
- [ ] **F21 · Reply meta badge** — return `meta: {tool, latencyMs, tokens}` on `/api/chat` and render it as a subtle line under the reply; hide when `tokens` is unknown. Acceptance: badge shows tool name for a tool-using reply, absent for a plain one.
- [ ] **F22 · CJK font fallback** — this host renders Chinese labels as tofu in headless screenshots; add a proper `font-family` stack (system CJK names first) plus a `<link>`-free fallback so Chinese text uses whatever the OS has. Acceptance: computed style lists CJK families; no layout shift.
- [ ] **F23 · Health metrics reset endpoint** — `POST /api/metrics/reset` (localhost-only, 403 otherwise) to zero counters without a restart. Acceptance: counters zero afterwards, non-local request → 403.

## Done

<!-- Move completed items here with the commit sha. -->
