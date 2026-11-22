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
let preloadErrored = false;
window.addEventListener('vite:preloadError', () => {
  preloadErrored = true;
  try {
    if (sessionStorage.getItem(PRELOAD_RELOAD_KEY) === '1') return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
  } catch {
    return;
  }
  location.reload();
});
// P434 — the flag lives in sessionStorage, so without a reset it is spent for
// the tab's whole life: a healthy page after deploy A would have no reload
// left when deploy B lands. Once the app has survived `load` + 3s without a
// preloadError it is provably healthy, so return the one-shot. A page that
// reloaded into a still-broken bundle fires preloadError again inside that
// window, which keeps the flag and the loop stays blocked.
window.addEventListener('load', () => {
  setTimeout(() => {
    if (preloadErrored) return;
    try {
      sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
    } catch {
      // Storage disabled — flag handling already fails closed elsewhere.
    }
  }, 3000);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
