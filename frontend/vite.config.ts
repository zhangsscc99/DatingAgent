import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // P227: running `npx vitest` inside frontend/ resolves this file, not the
  // repo-root vitest.config.mts — without a test section vitest falls back
  // to the 5s default timeout, which is under the cold react-dom + App
  // mount on this box and poisons sibling tests via a leaked act() call.
  // These mirror the root settings (30s budget, bounded thread pool).
  test: {
    environment: 'node',
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'threads',
    minWorkers: 1,
    maxWorkers: 4,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
