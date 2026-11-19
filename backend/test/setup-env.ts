import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * P359 — every test file gets its own session-shard dir so writes never
 * land in the repo's real backend/data/sessions, and a fixed id in one
 * file can never meet a stale shard from another file or an older run.
 * A test may still override DATING_SESSIONS_DIR itself.
 */
if (!process.env.DATING_SESSIONS_DIR) {
  process.env.DATING_SESSIONS_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'dating-sessions-test-'),
  );
}
