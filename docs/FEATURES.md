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
- **P106 · Unsent draft persistence** — keep the composer's in-progress text in localStorage per session so a refresh doesn't lose a half-typed message; cleared on send, capped at 4 KB, pure frontend.
- **P107 · Health payload model field** — include the configured LLM model name (from env, not the key) in `/api/health` so testers can confirm which model is live; one field, no schema break.
- **P108 · Theme-aware meta theme-color** — update the `<meta name="theme-color">` when the F08 toggle switches light/dark so mobile browser chrome matches; pure attribute update.
- **P46 · Health endpoint cache headers** — add `Cache-Control: no-store` to `/api/health` so proxies never serve a stale status; one middleware line, no payload change.
- **P47 · Session title from first message** — derive a truncated (≤20 char) title from the first user message and show it in the session dropdown instead of raw IDs; pure frontend string slice.
- **P48 · Focus input after send** — after a reply completes, refocus the composer so keyboard users can type immediately; one `focus()` call, no layout change.
- **P22 · Message copy button** — hover a bubble to reveal a one-click "复制" that copies its text via navigator.clipboard, with brief 已复制 feedback; no layout shift.
- **P23 · Empty-state suggestions** — when a conversation has no messages, show 3 tappable starter prompts (e.g. 自我介绍/找话题/化解尴尬) that fill the composer.
- **P24 · Scroll-to-bottom button** — floating ↑ button appears when scrolled away from latest message in chat view; smooth-scrolls back.
- **P25 · Character counter** — live char count near the composer that turns amber as the 4000-char 413 limit approaches; resets on send.
- **P103 · Copy-reply accessible feedback** — announce "已复制" via a visually-hidden `aria-live="polite"` region instead of a transient toast, so screen readers get the confirmation; pure frontend.
- **P104 · Health uptime field** — add `uptimeSec: process.uptime()` to `/api/health` payload; one line in `lib/health.ts`, no schema break.
- **P105 · Composer autofocus on load** — focus the message input once on first page load (respecting `prefers-reduced-motion` users who may use screen readers; skip if any modal is open); one `useEffect` + `focus()`.
- **P26 · Regenerate reply** — "换一个" action on the last assistant bubble that re-issues the same user message, replacing that single reply in place.
- **P27 · System-status footer** — tiny footer dot on /api/health status (green ok / yellow degraded), polled every 60 s; no keys or PII shown.

- **P109 · SSE heartbeat comment** — send a `: keepalive` SSE comment on `/api/chat/stream` every 15s while the model thinks, so proxies don't cut idle connections; pure backend, no payload change.
- **P110 · HTML-escape exported text** — F07 Markdown export escapes `<`, `>`, `&` in user/LLM text so a pasted `<script>` can't execute if the .md is rendered as HTML; pure string map.
- **P111 · Disable title edit while sending** — the session title input is read-only while a reply is streaming, avoiding mid-flight rename races; one `disabled` binding.
- **P112 · `/api/version` no-store cache header** — same `Cache-Control: no-store` protection as P46 but for the build-info endpoint, so a proxy can't pin a stale gitSha; one header line.
- **P113 · Streaming status via aria-live** — announce "正在生成…" through the existing visually-hidden aria-live region when a stream starts and clear it on completion, reusing P103's pattern; pure frontend.
- **P115 · Favicon 404 guard** — audit the static asset path served for the favicon so requests don't 404 in server logs; one-line fix if missing.
- **P116 · README metrics field docs** — document the F14 `metrics` object shape in the README endpoint table; docs-only.
- **P117 · Export button aria-label** — F07 export action gets an explicit `aria-label` matching its visible text for screen readers; one attribute.
- **P114 · Composer maxlength hint** — set `maxlength={4000}` on the composer textarea so browsers hard-stop typing past the 413 limit; one attribute.

<!-- Human review needed — these are candidates, not scheduled work. -->
- **P04 · Request id + error correlation** — attach a short `x-request-id` per request, echo it in error JSON and the structured log line, so a client-reported failure can be matched to its log entry. No persistence.
- **P05 · Health probe detail** — `GET /api/health?verbose=1` (localhost-only) adds disk-free, RSS, uptime and last-error to the metrics payload, keeping the public health payload unchanged.
- **P06 · Input history recall** — composer remembers the last 5 sent messages in localStorage with ↑ recall (terminal-style), capped at ~10 KB, purely client-side.
- **P01 · Conversation history persistence** — optional localStorage-backed reload of the last session (opt-out toggle), so refresh doesn't lose context. Low risk; needs a size cap (~50 KB) and a "清除历史" action.
- **P02 · Streaming tokens count** — `/api/chat/stream` currently lacks the `meta` badge data F21 added to the non-streaming path; emit a final SSE `meta` event with tool/latencyMs/tokens.
- **P03 · Rate-limit headers** — expose `X-RateLimit-Remaining` and `Retry-After` on all `/api/*` responses so clients can back off gracefully instead of discovering the 429 by surprise.
- **P61 · Composer send-disabled during streaming** — while a `/api/chat/stream` reply is in flight, disable the send button (visual dim) to avoid double-submit queuing; pure UI state already tracked by the streaming flag.
- **P62 · Session title tooltip** — full (untruncated) session title on hover via native `title` attribute in the P08 history dropdown; one attribute, no layout change.
- **P63 · Relative-time Intl helper** — extract P40's relative-time formatting into a shared util used by both session dropdown and meta badge, removing duplicated logic; no behavior change.

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
- **P40 · Session list relative timestamps** — show "3 分钟前 / 2 天前" style relative times in the session dropdown instead of raw dates; pure formatting helper.
- **P41 · Composer Enter-to-send hint** — small dim caption "Enter 发送 / Shift+Enter 换行" under the composer, purely static UI text.
- **P42 · Footer chip click scrolls to top** — clicking the P27 health chip smooth-scrolls the chat view to the top; pure frontend handler.
- **P43 · Composer char counter** — subtle `n / 2000` counter in the composer corner that only appears past 80% of a max length; pure frontend.
- **P44 · Copy full conversation** — reuse P31/P16 copy pattern to copy all messages of the current session as plain text; no backend change.
- **P45 · Toast auto-dismiss timer** — give success toasts a fixed 3s auto-dismiss (errors stay until closed) using the existing toast component.
- **P49 · Session cleanup cron trigger** — localhost-only `POST /api/sessions/evict` reusing F01's idle-TTL logic so ops can force-expire stale sessions without waiting 30 min; reuses existing eviction code, no persistence.
- **P50 · SSE stream abort endpoint** — support `x-stream-id` on `/api/chat/stream` and a `DELETE /api/stream/:id` that closes that SSE and aborts the LLM call, complementing P12's client-side AbortController; no new deps.
- **P52 · Rate-limit per-session token bucket** — expose remaining quota in the F02 429 body as `{retryAfterSec}` instead of only the header, so the frontend can render a countdown; pure response shaping, no logic change.
- **P53 · Chat input maxlength** — set `maxlength={4000}` on the composer textarea to match the F02 server limit, preventing 413s entirely at the UI layer; one attribute.
- **P54 · Version endpoint uptime** — add `uptimeSec` from `process.uptime()` to `/api/version` payload, letting ops spot restarts without touching /api/health's contract; one field.
- **P55 · Composer paste plain-text only** — on paste in the composer, strip rich-text formatting (paste as plain text) so Markdown export stays clean; small client handler.
- **P56 · Session count badge** — show the number of sessions next to the P33 history dropdown label, updated from the same `/api/sessions` fetch; no extra requests.
- **P57 · Export filename timestamp** — F07 export filename gains `YYYYMMDD-HHmm` suffix so repeated exports don't collide in Downloads; one-line change.
- **P58 · Composer focus on session switch** — after picking a session in the P33 dropdown, auto-focus the composer textarea; pure frontend, one `focus()` call.
- **P59 · Copy feedback tick** — P31/P16 copy buttons briefly show "已复制" state for 1.5s instead of firing a toast; pure UI state.
- **P60 · Health chip raw-time tooltip** — P27 footer chip tooltip shows the exact last-poll timestamp (HH:MM:SS) alongside latency; reuses the same poll state.
- **P64 · Composer send on Ctrl/Cmd+Enter hint** — placeholder tooltip noting Enter sends / Shift+Enter newline; zero logic, pure text.
- **P65 · Session list relative time** — P33 dropdown shows "x分钟前" instead of raw timestamps via an Intl.RelativeTimeFormat; pure frontend.
- **P66 · Health chip latency color** — P27 chip turns amber above 1500ms, red above 5000ms; pure UI threshold on existing poll state.
- **P67 · Composer char counter tooltip** — P43 counter's tooltip explains the 4000 limit and where it comes from (F02); pure static text.
- **P68 · Session dropdown keyboard hint** — label of the P33 dropdown shows a dim "点击展开" hint for keyboard users; pure cosmetic text.
- **P70 · Meta badge title attribute** — F21 badge gets a native `title` with full latency/tokens detail on hover; one attribute, no layout change.
- **P71 · Export includes language tag** — F07 Markdown export notes the active P09 reply-language setting in the header line; pure string addition.
- **P72 · Empty-state chips honour theme** — F20 starter chips use existing CSS variables only (audit + fix any hard-coded colours); no behavior change.
- **P73 · Composer auto-grow** — composer textarea grows with content up to ~6 lines, then scrolls internally; pure client-side height logic, no layout regression at rest.
- **P74 · Stick-to-bottom while streaming** — chat container auto-scrolls to the newest token only when the user is already within ~100px of the bottom, so reading history isn't hijacked; small scroll handler.
- **P75 · Reduced-motion scroll guard** — programmatic auto-scrolls (P74, F24's scroll-to-bottom) respect the F15 `prefers-reduced-motion` guard by jumping instantly instead of animating; one media-query check.
- **P76 · Version footer in chat header** — header shows the /api/version gitSha (short) as a dim, non-interactive span so testers can verify deploys at a glance; one fetch + one span.
- **P77 · Health chip ARIA live region** — P27 latency chip gets `aria-live="polite"` so screen readers hear status changes; one attribute, no visual change.
- **P78 · Composer placeholder rotation** — composer cycles 3 example questions as placeholder text when idle; pure frontend setInterval, cleared on focus.
- **P79 · Chat header status dot** — small green/amber dot next to the header title fed by the existing P27 health poll (green <2000ms, amber otherwise); pure UI, no new requests.
- **P80 · Export session metadata header** — F07 Markdown export gains a one-line metadata header (session title + message count) above the existing content; pure string formatting.
- **P81 · Health chip click copies status JSON** — clicking the P27 chip copies the latest health JSON to clipboard reusing P31's copy pattern with its tick feedback; no backend change.
- **P82 · Favicon + document title** — ship a simple SVG favicon and set `document.title` to "DatingAgent" so browser tabs aren't blank/generic; pure static asset, no runtime logic.
- **P83 · Reply meta tool tooltip** — when the F21 meta badge shows a tool name, add a `title` attribute explaining what the tool did (reuse `/api/tools` description); one attribute, no API change.
- **P84 · Composer paste guard** — when pasting text over the 4000-char limit, cap the inserted text at the limit and flash the char counter red once; pure frontend string slice, prevents predictable 413s.
- **P85 · Health uptime line** — include `uptimeSec` (process.uptime()) in the existing /api/health metrics object; one field, no new endpoint, lets the P27 footer show "up for X".
- **P86 · Composer placeholder hint** — rotate the composer's `placeholder` to a short contextual hint (e.g. "输入消息… Ctrl+Enter 发送") so F10's shortcuts are discoverable without opening the tooltip; pure attribute.
- **P87 · Error message i18n** — map the few user-facing error strings (413/429/network) to zh text via a tiny const map so the UI never shows raw English error bodies; no framework, one file.
- **P88 · Session delete confirm** — P33 history dropdown's per-item delete gets a `confirm()` guard so a stray click can't drop a session; one line, no layout change.
- **P89 · Health JSON pretty toggle** — `GET /api/health?pretty=1` returns the same payload with 2-space indentation for humans reading it in a browser; pure response formatting.
- **P90 · Export copies tool lines** — F07 Markdown export marks messages that used a tool with a `(tool: name)` suffix, reusing F21's meta data; pure string addition.
- **P91 · Composer hint respects language toggle** — the "Enter 发送 / Shift+Enter 换行" caption (P41) and composer hints switch text with the P09 language setting; one small map, no new state.
- **P92 · Version endpoint headers** — return `Cache-Control: no-store` and expose `X-Build-Time` on `/api/version` so testers can confirm a fresh deploy from response headers alone; two header lines, no body change.
- **P93 · Health status field documentation** — README table gains a one-row explanation of `status: ok|degraded` semantics (what makes it degraded); docs-only, no code.
- **P94 · Scroll-to-bottom button a11y label** — the F24 button gets `aria-label="滚动到底部"` and focus styling; one attribute, no layout change.
- **P95 · Session dropdown empty-state text** — when no sessions exist the P33 dropdown shows a dim "暂无历史会话" line instead of blank space; pure static text.
- **P96 · Version endpoint uptime field** — add `uptimeSec` to /api/version payload alongside gitSha so one request confirms both build freshness and restart; one field.
- **P97 · Session dropdown current selection check** — the active session in the P33 dropdown shows a `✓` prefix instead of relying on highlight alone; one conditional class/icon, no new state.
- **P98 · Footer year auto-update** — replace any hard-coded footer year with `new Date().getFullYear()` so it never goes stale; one expression.
- **P99 · Chat message max-width guard** — ensure reply bubbles cap at a readable max-width (audit existing CSS, set one `max-width` if missing) so long LLM replies stay legible on wide screens; one CSS line.
- **P100 · Health chip keyboard focus** — P27 footer chip becomes a real `<button>` with visible focus ring so keyboard users can reach it (P42/P81 rely on clicking); pure a11y, no behavior change.
- **P101 · Export button disabled when empty** — F07 export and P16 copy actions are disabled (dim + `aria-disabled`) when the conversation has zero messages, preventing empty .md files; pure UI state.
- **P102 · Backlog lint in refresh-version** — `scripts/refresh-version.sh` exits non-zero if `/api/version` sha mismatch persists after restart, so the loop catches stale builds immediately; shell-only, no app change.
- **P118 · Health degraded reason field** — when /api/health reports `degraded`, include a one-word `reason` (e.g. "llm" vs "memory") so the README's P93 semantics are actionable; one field.
- **P119 · Copy-all-transcript action** — footer gains a "复制全文" button that copies the whole conversation as plain text, reusing P31's clipboard pattern; pure frontend.
- **P120 · Version footer title attr** — the P76 gitSha span gets a `title` with the full build time so hovering explains the short sha; one attribute.
- **P121 · Composer textarea spellcheck off** — set `spellcheck={false}` on the composer so dating-advice slang/pinyin isn't red-underlined; one attribute, pure frontend.
- **P122 · Error toast role="alert"** — chat error toasts get `role="alert"` so screen readers announce failures without focus theft; one attribute, reuses existing toast.
- **P123 · Health poll backoff on failure** — the P27 health poll skips its next tick after a failed fetch (doubling interval once, capped at 5 min) so a down backend isn't hammered; small timer tweak.
- **P124 · Composer autocomplete off** — set `autocomplete="off"` on the composer textarea so browsers don't suggest previously-sent personal messages; one attribute, pure frontend.
- **P125 · Export button title tooltip** — F07 export action gets a native `title` explaining the .md download format and filename pattern; one attribute, no layout change.
- **P126 · Session dropdown focus return** — when the P33 history dropdown closes, focus returns to its trigger button so keyboard users don't lose their place; one `focus()` call, pure a11y.
- **P127 · Composer autocapitalize/autocorrect off** — set `autoCapitalize="none"` and `autoCorrect="off"` on the composer textarea alongside P124's autocomplete so mobile keyboards stop mangling slang/pinyin input; two attributes, pure frontend.
- **P128 · Document lang syncs with language toggle** — when the P09 language setting changes, set `document.documentElement.lang` to `zh-CN` or `en` so screen readers use the right pronunciation; one `useEffect`, no new state.
- **P129 · Health chip aria-pressed** — the P27 footer chip that toggles the details panel gets `aria-pressed` reflecting open/closed so screen readers announce the toggle state; one attribute, pure frontend.
- **P130 · Composer Ctrl/Cmd+Enter to send** — pressing Ctrl+Enter (or Cmd+Enter) in the composer sends the message without touching the send button; one keydown handler, pure frontend, no effect on plain Enter behavior.
- **P131 · Health endpoint gitSha unchanged check** — guard `/api/version` so it falls back to `unknown` when the build-info file is missing instead of throwing a 500; one try/catch in `lib/version.ts`, no schema change.
- **P132 · Session list keyboard navigation** — arrow-up/arrow-down moves focus between items in the session dropdown so keyboard users can switch sessions without tabbing through every control; one onKeyDown, pure frontend.
- **P133 · Skip-to-content link** — a visually-hidden "跳到主要内容" link as the first focusable element jumps focus to the chat area on Tab; pure a11y, no layout change.
- **P134 · Print stylesheet for transcript** — a small `@media print` block hides composer/buttons so Ctrl+P of the chat view prints a clean transcript; pure CSS.
- **P135 · Pause health poll when hidden** — the P27 health poll skips its tick while `document.hidden` and resumes on visibilitychange, avoiding wasted requests in background tabs; small timer tweak.
- **P136 · Escape closes modal** — pressing Escape closes any open modal/dialog (e.g. confirm dialogs) and restores focus to the trigger; small keydown handler, pure a11y.
- **P137 · prefers-reduced-motion disables smooth scroll** — the P24 scroll-to-bottom and chat auto-scroll use `behavior:'auto'` when the user prefers reduced motion; one media-query check, pure frontend.
- **P138 · Health payload node version field** — add `node: process.version` to `/api/health` so testers can confirm the runtime; one line in `lib/health.ts`, no schema break.
