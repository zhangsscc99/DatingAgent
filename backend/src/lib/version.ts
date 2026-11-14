import { BUILD_INFO } from '../generated/build-info.js';
import { resolvedGitSha } from './git-sha.js';

export interface VersionReport {
  version: string;
  gitSha: string;
  buildTime: string;
  node: string;
}

/**
 * Build identity for `GET /api/version`.
 *
 * `version` and `buildTime` come from the generated build-info module (written
 * by scripts/gen-build-info.mjs before `tsc`). `gitSha` is resolved once at
 * process start (see lib/git-sha.ts) so it matches `git rev-parse --short HEAD`
 * after a restart, even though the loop commits *after* it deploys.
 *
 * Serving a request still costs nothing: no git call, no file read.
 */
export function buildVersionReport(): VersionReport {
  return {
    version: BUILD_INFO.version,
    gitSha: resolvedGitSha,
    buildTime: BUILD_INFO.buildTime,
    node: process.version,
  };
}
