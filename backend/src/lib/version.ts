import { BUILD_INFO } from '../generated/build-info.js';

export interface VersionReport {
  version: string;
  gitSha: string;
  buildTime: string;
  node: string;
}

/**
 * Build identity for `GET /api/version`.
 *
 * `version`, `gitSha` and `buildTime` come from the generated build-info module
 * (written by scripts/gen-build-info.mjs before `tsc`), so serving a request
 * costs nothing: no git call, no file read.
 */
export function buildVersionReport(): VersionReport {
  return {
    version: BUILD_INFO.version,
    gitSha: BUILD_INFO.gitSha,
    buildTime: BUILD_INFO.buildTime,
    node: process.version,
  };
}
