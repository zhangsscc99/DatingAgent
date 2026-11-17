import { BUILD_INFO } from './build-info.js';
import { resolvedGitSha, resolvedGitShaSource, type GitShaSource } from './git-sha.js';

export interface VersionReport {
  version: string;
  gitSha: string;
  shaSource: GitShaSource;
  buildTime: string;
  node: string;
}

/**
 * Build identity for `GET /api/version`.
 *
 * `version` and `buildTime` come from the generated build-info module (written
 * by scripts/gen-build-info.mjs before `tsc`). `gitSha` is resolved once at
 * process start (see lib/git-sha.ts) so it matches `git rev-parse --short HEAD`
 * after a restart, even though the loop commits *after* it deploys. `shaSource`
 * names which layer won ('env' | 'repo' | 'build' | 'unknown') so a stale or
 * unresolved sha is diagnosable from the endpoint itself.
 *
 * Serving a request still costs nothing: no git call, no file read.
 */
export function buildVersionReport(): VersionReport {
  return {
    version: BUILD_INFO.version,
    gitSha: resolvedGitSha,
    shaSource: resolvedGitShaSource,
    buildTime: BUILD_INFO.buildTime,
    node: process.version,
  };
}
