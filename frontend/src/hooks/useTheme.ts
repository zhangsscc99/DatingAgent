import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'datingagent-theme';

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Stored choice wins; otherwise fall back to the OS preference. */
export function readThemePreference(): { theme: Theme; explicit: boolean } {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return { theme: stored, explicit: true };
  } catch {
    // localStorage can throw when storage is blocked — fall back to the system.
  }
  return { theme: systemTheme(), explicit: false };
}

/** Keep in sync with the `--bg` values in index.css and the index.html bootstrap. */
const THEME_COLORS: Record<Theme, string> = { light: '#f6f6f9', dark: '#0f0f12' };

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Mobile browser chrome follows <meta name="theme-color">; keep it matching.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[theme]);
}

export function useTheme(): { theme: Theme; toggle: () => void; set: (theme: Theme) => void } {
  const [state, setState] = useState<Theme>(() => readThemePreference().theme);

  useEffect(() => {
    applyTheme(state);
  }, [state]);

  // Follow OS changes while the user has not made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readThemePreference().explicit) return;
      setState(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Persisting is best-effort; the toggle still works for this session.
      }
      applyTheme(next);
      return next;
    });
  }, []);

  // P196: the settings sheet needs an explicit light/dark pick, not a flip.
  const set = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the choice still applies to this session.
    }
    applyTheme(next);
    setState(next);
  }, []);

  return { theme: state, toggle, set };
}
