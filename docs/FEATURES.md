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

- [x] **F16 · Fix stale /api/version sha** — `gitSha` currently reports the *previous* commit because `ci-deploy.sh` builds before the loop commits. Generate build-info after commit, or have ci-deploy re-run `node scripts/gen-build-info` + rebuild only the backend after commit. Acceptance: `/api/version` gitSha == `git rev-parse --short HEAD` on a clean tree.
- [x] **F17 · Tool input schemas in /api/tools** — expose each tool's parameter names/types (derive from the zod schemas in `tools/registry.ts`) so the UI can show what each tool needs. Acceptance: `/api/tools` returns `inputs` per tool; no schema duplication.
- [x] **F18 · Control-character sanitisation** — strip NUL/ESC and other control chars from `message` before it reaches the LLM; keep newlines/tabs. Acceptance: `\u0000`-laden message returns 200 and the log line stays single-line valid JSON.
- [x] **F19 · SSE keepalive** — send a `: ping` comment every 15 s on `/api/chat/stream` while the model is thinking, so proxies don't drop idle connections. Acceptance: a deliberately slow tool still streams to completion through a 30 s window.
- [x] **F20 · Empty-state prompt chips** — when a conversation has no messages, show 3 tappable starter prompts (资料优化 / 聊天指导 / 约会规划) that prefill the composer. Acceptance: chip click fills the input, sends, and disappears after the first message.
- [x] **F21 · Reply meta badge** — return `meta: {tool, latencyMs, tokens}` on `/api/chat` and render it as a subtle line under the reply; hide when `tokens` is unknown. Acceptance: badge shows tool name for a tool-using reply, absent for a plain one.
- [x] **F22 · CJK font fallback** — this host renders Chinese labels as tofu in headless screenshots; add a proper `font-family` stack (system CJK names first) plus a `<link>`-free fallback so Chinese text uses whatever the OS has. Acceptance: computed style lists CJK families; no layout shift.
- [x] **F23 · Health metrics reset endpoint** — `POST /api/metrics/reset` (localhost-only, 403 otherwise) to zero counters without a restart. Acceptance: counters zero afterwards, non-local request → 403.

## Proposed
- **P22 · Message copy button** — hover a bubble to reveal a one-click "复制" that copies its text via navigator.clipboard, with brief 已复制 feedback; no layout shift.
- **P23 · Empty-state suggestions** — when a conversation has no messages, show 3 tappable starter prompts (e.g. 自我介绍/找话题/化解尴尬) that fill the composer.
- **P24 · Scroll-to-bottom button** — floating ↑ button appears when scrolled away from latest message in chat view; smooth-scrolls back.
- **P25 · Character counter** — live char count near the composer that turns amber as the 4000-char 413 limit approaches; resets on send.
- **P26 · Regenerate reply** — "换一个" action on the last assistant bubble that re-issues the same user message, replacing that single reply in place.
- **P27 · System-status footer** — tiny footer dot on /api/health status (green ok / yellow degraded), polled every 60 s; no keys or PII shown.

<!-- Human review needed — these are candidates, not scheduled work. -->
- **P04 · Request id + error correlation** — attach a short `x-request-id` per request, echo it in error JSON and the structured log line, so a client-reported failure can be matched to its log entry. No persistence.
- **P05 · Health probe detail** — `GET /api/health?verbose=1` (localhost-only) adds disk-free, RSS, uptime and last-error to the metrics payload, keeping the public health payload unchanged.
- **P06 · Input history recall** — composer remembers the last 5 sent messages in localStorage with ↑ recall (terminal-style), capped at ~10 KB, purely client-side.
- **P01 · Conversation history persistence** — optional localStorage-backed reload of the last session (opt-out toggle), so refresh doesn't lose context. Low risk; needs a size cap (~50 KB) and a "清除历史" action.
- **P02 · Streaming tokens count** — `/api/chat/stream` currently lacks the `meta` badge data F21 added to the non-streaming path; emit a final SSE `meta` event with tool/latencyMs/tokens.
- **P03 · Rate-limit headers** — expose `X-RateLimit-Remaining` and `Retry-After` on all `/api/*` responses so clients can back off gracefully instead of discovering the 429 by surprise.

- **P07 · Rate-limit status surface** — show remaining request budget as a subtle indicator near the composer (reads the headers from P03 client-side), warn colour at < 5 remaining. Purely UI; no backend change.
- **P08 · Session list UI** — small "历史会话" dropdown listing active sessions from `GET /api/sessions` with per-item delete, reusing F01's endpoints; capped display of 10 entries.
- **P09 · Reply language quick toggle** — a 🌐 button beside the composer cycling zh/en/auto, mapping to F11's `language` param; state persisted per session in localStorage.
- **P10 · Message length meter** — live character count (e.g. `1234/4000`) under the composer turning amber past 3500, so users see the 413 limit before hitting it. Purely UI.
- **P11 · Offline / LLM-down banner** — when `/api/chat` returns 5xx or network fails, show a dismissible top banner "服务暂时不可用" with retry affordance instead of only inline error text. Purely UI.
- **P12 · Stop generation button** — for `/api/chat/stream` calls, show a "停止" button that aborts via `AbortController` while streaming; backend already closes the SSE on client disconnect. Small frontend + no backend change.
- **P16 · Copy export as Markdown** — beside F07's download, a "复制 Markdown" action putting the same formatted transcript on the clipboard; pure frontend reuse of the export builder.
- **P17 · Unread error toast timing** — auto-dismiss chat error toasts after 8 s with a close button, instead of persistent banners that accumulate. Purely UI, no state deps.
- **P18 · Health self-check chip** — tiny dot in the header polling `/api/health` every 60 s, green/red on llmConfigured status; purely decorative, no alerting.

- **P19 · Chat message search** — a small search box filtering rendered messages client-side by keyword with match highlighting; no backend change.
- **P20 · Suggested opening lines** — on an empty session, render 3 clickable starter prompts ("帮我开场", "继续话题", "约她周末") that fill the composer; purely frontend constants.
- **P21 · Response time display** — reuse F21's `meta.latencyMs` to show "约 Xs" next to the meta badge, formatted in Chinese; no new requests.

## Done

<!-- Move completed items here with the commit sha. -->
- **P13 · Chat export** — "导出" button downloading the current conversation as plain-text .txt (timestamped filename), built entirely client-side from state.
- **P14 · Composer auto-resize** — textarea grows with content up to ~6 lines then scrolls, so long prompts stay visible while typing. Purely CSS + a few lines of JS.
- **P15 · Light/dark theme toggle** — a small toggle persisting `theme` in localStorage, respecting `prefers-color-scheme` as default; uses existing CSS variables only.

- **P28 · Composer blur-fix placeholder** — placeholder text stays until first keystroke (some browsers clear it on focus), purely cosmetic UX fix.
- **P29 · Chat meta badge i18n** — meta badge labels (工具/耗时) respect the P09 language toggle instead of hard-coded Chinese.
- **P30 · Export filename sanitizer** — strip invalid filename chars from the F07 download name when session title is user-derived.

- **P31 · Copy single message** — a small "复制" affordance on each chat bubble putting that message's text on the clipboard; pure frontend, reuses existing copy pattern from P16.
- **P32 · Keyboard shortcut for export** — Ctrl/Cmd+E triggers F07's export when the chat view is focused; purely client-side key handler with a hint in the UI tooltip.
- **P33 · Empty-session graceful state** — when the session list is empty, `GET /api/sessions` dropdown shows a disabled "暂无历史会话" option instead of a bare blank dropdown; pure UI.

- **P34 · Toast position consistency** — unify error/info toast placement to top-center with the same slide-in animation across chat and session views; pure CSS tweak.
- **P35 · Composer placeholder rotation** — cycle 3 friendly placeholder strings in the composer when idle, purely frontend constants, no logic deps.
- **P36 · Health latency in footer chip** — extend P27's footer dot tooltip with last /api/health latency in ms from the same poll; no extra requests.
- **P37 · Chat scroll-to-bottom on new reply** — when a reply arrives while the user has scrolled up, show the P24 floating ↑ state without yanking the viewport; purely frontend scroll handling.
- **P38 · Rate-limit retry countdown** — on a 429, render the `Retry-After` seconds as a countdown on the error toast so the user knows when to resend; pure UI.
- **P39 · Export includes meta badges** — F07's Markdown export gains a per-reply `> meta` line (tool/latency) when F21 data exists; no new requests.
