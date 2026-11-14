import { defineConfig } from 'vitest/config';

/**
 * F12 — unit tests live in backend/test and import the backend sources
 * directly (no build step). `npm test` regenerates build-info first, since
 * `backend/src/generated/` is gitignored.
 */
export default defineConfig({
  test: {
    include: ['backend/test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
