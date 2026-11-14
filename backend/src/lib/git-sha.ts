import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INFO } from '../generated/build-info.js';

/**
 * F16 — resolve the running commit **once, at process start**.
 *
 * The feature loop deploys before it commits, so a sha frozen by
 * `scripts/gen-build-info.mjs` during that build is always one commit behind:
 * `/api/version` would report the parent commit until the *next* deploy.
 *
 * Two-layer resolution keeps the endpoint honest without shelling out per
 * request (F04's constraint):
 *   1. `GIT_SHA` env — explicit CI override, wins over everything.
 *   2. `git rev-parse --short HEAD` in the enclosing checkout, executed a
 *      single time when this module is first imported.
 *   3. `BUILD_INFO.gitSha` — the build-time value, fallback for deployments
 *      that ship `dist/` without a `.git` directory.
 */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

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

function resolveGitSha(): string {
  const fromEnv = process.env.GIT_SHA?.trim();
  if (fromEnv && SHA_RE.test(fromEnv)) return fromEnv;
  return readHeadSha() ?? BUILD_INFO.gitSha;
}

/** Commit the running process was started from. Read once; never per request. */
export const resolvedGitSha: string = resolveGitSha();
