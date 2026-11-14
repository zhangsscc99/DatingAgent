# DatingAgent autonomous feature loop — operating rules

Cron runs this loop every 10 minutes. These are hard constraints for any agent working the backlog.

## Scope
- Work only inside `/www/DatingAgent`. Never touch `/www/jinshu` or other projects/pm2 apps.
- One feature per run: first **unchecked** item in `docs/FEATURES.md`, top-down. No batching.
- Never modify secrets or process config: `ecosystem.config.cjs`, `.env*`, `scripts/make-ecosystem.py`, `scripts/ci-deploy.sh`, `scripts/rollback.sh`. They are gitignored and hold the live LLM key.
- No new runtime dependencies unless the feature is impossible without one. No framework swaps, no unrelated refactors.
- `git push` is forbidden — commits stay local.

## Workflow
1. `git status --porcelain`: if dirty from a previous run, run `bash scripts/rollback.sh` and report that instead of starting new work.
2. Implement the first unchecked backlog item end to end (backend `backend/src`, frontend `frontend/src`, CSS beside components).
3. `bash scripts/ci-deploy.sh` → build, pm2 restart, `/api/health` poll, live `/api/chat` smoke test.
4. Non-zero exit → `bash scripts/rollback.sh`, leave the box unticked, report the build error. Do not attempt a second fix in the same run.
5. Success → tick the box, append `YYYY-MM-DD HH:MM | F0X | what changed` to `docs/DEVLOG.md`, then
   `git add -A && git commit -m "feat: F0X <summary>"`.

## Environment
- `npm` at `/usr/local/bin/npm`, pm2 at `/root/.nvm/versions/node/v24.5.0/bin/pm2` (scripts set `PATH`).
- pm2 app `dating-agent`, port **3012**, backend serves `frontend/dist`, health `http://127.0.0.1:3012/api/health`.
- LLM: Aliyun DashScope OpenAI-compatible endpoint, model `qwen3.8-flash` (same key as jinshu project).
- TypeScript is strict; `npm run build` must be clean.

## Reporting
Max 4 lines: `F0X <title>: done|failed`, commit sha, one line of evidence (health JSON + smoke reply), blockers.
