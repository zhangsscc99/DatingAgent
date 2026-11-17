import { defineConfig } from 'vitest/config';

/**
 * F12 — unit tests live in backend/test and import the backend sources
 * directly (no build step). `npm test` regenerates build-info first, since
 * `backend/src/generated/` is gitignored.
 *
 * F30b — deterministic timeouts under parallel load: 30s covers the cold
 * react-dom + src/App import on this 4-CPU box, and the bounded thread pool
 * keeps 100 test files from all mounting React at once.
 */
export default defineConfig({
  test: {
    include: ['backend/test/**/*.test.ts', 'frontend/test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
  },
});
