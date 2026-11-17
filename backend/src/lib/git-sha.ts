import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO } from './build-info.js';

/**
 * F16 / P236 — resolve the running commit **once, at process start**.
 *
 * The feature loop deploys before it commits, so a sha frozen by
 * `scripts/gen-build-info.mjs` during that build is always one commit behind:
 * `/api/version` would report the parent commit until the *next* deploy.
 *
 * Three-layer resolution keeps the endpoint honest without shelling out per
 * request (F04's constraint):
 *   1. `GIT_SHA` env — explicit CI override, wins over everything.
 *   2. `git rev-parse --short HEAD` in the enclosing checkout, executed a
 *      single time when this module is first imported — this is what makes a
 *      post-commit `pm2 restart` report the NEW head.
 *   3. `BUILD_INFO.gitSha` — the build-time value, fallback for deployments
 *      that ship `dist/` without a `.git` directory.
 *
 * When none of the layers yields a sha the report carries the literal string
 * `'unknown'` — loud and unmatchable, so `scripts/refresh-version.sh` exits
 * non-zero instead of silently serving a stale commit.
 */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export type GitShaSource = 'env' | 'repo' | 'build' | 'unknown';

export interface GitShaResolution {
  sha: string;
  source: GitShaSource;
}

export interface GitShaDeps {
  envSha?: string | undefined;
  readHead?: (() => string | null) | undefined;
  bakedSha?: string | undefined;
}

/**
 * Pure resolution: env var > repo HEAD at process start > baked build-info.
 * Every dependency is injected so the order is testable without git or pm2.
 */
export function resolveGitSha({ envSha, readHead, bakedSha }: GitShaDeps): GitShaResolution {
  const fromEnv = envSha?.trim();
  if (fromEnv && SHA_RE.test(fromEnv)) return { sha: fromEnv, source: 'env' };

  let fromRepo: string | null = null;
  try {
    fromRepo = readHead?.() ?? null;
  } catch {
    fromRepo = null;
  }
  if (fromRepo && SHA_RE.test(fromRepo)) return { sha: fromRepo, source: 'repo' };

  const baked = bakedSha?.trim();
  if (baked && SHA_RE.test(baked)) return { sha: baked, source: 'build' };

  return { sha: 'unknown', source: 'unknown' };
}

/** Walk up from the compiled module to the checkout root (dist/lib → repo). */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readHeadSha(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (!repoRoot) return null;

  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return SHA_RE.test(sha) ? sha : null;
  } catch {
    // git missing, not a checkout, or detached weirdness — use the baked value.
    return null;
  }
}

const resolution = resolveGitSha({
  envSha: process.env.GIT_SHA,
  readHead: readHeadSha,
  bakedSha: BUILD_INFO.gitSha,
});

/** Commit the running process was started from. Read once; never per request. */
export const resolvedGitSha: string = resolution.sha;

/** Which layer produced `resolvedGitSha` — surfaced on /api/version for trust. */
export const resolvedGitShaSource: GitShaSource = resolution.source;
