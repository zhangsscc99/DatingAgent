import type { BuildInfo } from '../generated/build-info.js';

export type { BuildInfo };

const FALLBACK: BuildInfo = {
  version: 'unknown',
  gitSha: 'unknown',
  buildTime: 'unknown',
};

/**
 * Resolve the generated build-info module without letting a missing or broken
 * file take the process down — `/api/version` (and `/api/health`) must still
 * answer. Resolved once at module load; serving requests costs nothing.
 */
export const BUILD_INFO: BuildInfo = await import('../generated/build-info.js')
  .then((mod) => mod.BUILD_INFO)
  .catch(() => FALLBACK);
