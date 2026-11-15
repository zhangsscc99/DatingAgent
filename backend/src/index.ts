import { loadAndValidateEnv } from './config/env.js';
import { createApp } from './routes/app.js';

const config = loadAndValidateEnv();
const app = createApp({ llmConfigured: config.llm.configured, llmModel: config.llm.model });

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`🌹 DatingAgent backend running on http://0.0.0.0:${config.port}`);
  console.log(`   API:  http://0.0.0.0:${config.port}/api/health`);
  console.log(`   LLM:  ${config.llm.configured ? 'live' : 'mock mode'}`);
});

/** How long to let in-flight requests finish before forcing the process down. */
const SHUTDOWN_TIMEOUT_MS = 8000;

let shuttingDown = false;

/**
 * Stop accepting new connections, let in-flight requests drain, exit 0.
 * A second signal or the timeout forces exit so a stuck socket cannot
 * leave the old process holding port 3012 (the EADDRINUSE case).
 */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    console.log(`[shutdown] ${signal} again — exiting immediately`);
    process.exit(0);
  }
  shuttingDown = true;

  console.log(`[shutdown] ${signal} received — closing server on port ${config.port}`);

  const forceExit = setTimeout(() => {
    console.log(`[shutdown] still busy after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err?: Error) => {
    if (err) console.error(`[shutdown] close error: ${err.message}`);
    else console.log('[shutdown] server closed, exiting 0');
    process.exit(0);
  });

  // Keep-alive sockets would otherwise pin the listener open until their timeout.
  server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
