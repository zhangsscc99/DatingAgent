import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startInteractionTracking } from './lib/interactionState';
import './index.css';
import './print.css';

startInteractionTracking();

// P433 — a tab still open across a deploy requests chunks whose hashed names
// no longer exist (P430 404 / SPA shell), the module load fails silently and
// vite:preloadError fires. Reload once per session: the sessionStorage flag
// is written before the reload so a still-broken next load cannot loop, and
// any storage failure (disabled / throwing) skips the reload entirely.
const PRELOAD_RELOAD_KEY = 'datingagent.preloadReloadAttempted';
window.addEventListener('vite:preloadError', () => {
  try {
    if (sessionStorage.getItem(PRELOAD_RELOAD_KEY) === '1') return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  } catch {
    return;
  }
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
