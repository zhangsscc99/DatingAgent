/**
 * P281 — desktop sidebar collapse preference, persisted in localStorage.
 * The functions take an optional storage so tests never need a DOM; the
 * default is globalThis.localStorage, guarded for private-mode throws.
 */

export const SIDEBAR_COLLAPSED_KEY = 'datingAgent.sidebarCollapsed';

export const COLLAPSE_SIDEBAR_LABEL = '收起侧栏';
export const EXPAND_SIDEBAR_LABEL = '展开侧栏';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(store?: StorageLike): StorageLike | null {
  if (store) return store;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Persisted preference; anything that isn't a stored "collapsed" reads as expanded. */
export function isCollapsed(store?: StorageLike): boolean {
  const s = resolveStorage(store);
  if (!s) return false;
  try {
    const raw = s.getItem(SIDEBAR_COLLAPSED_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export function saveCollapsed(collapsed: boolean, store?: StorageLike): void {
  const s = resolveStorage(store);
  if (!s) return;
  try {
    s.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage full or blocked — the toggle still works for this session */
  }
}

/** aria-label/title for the header toggle: it names the action it performs. */
export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? EXPAND_SIDEBAR_LABEL : COLLAPSE_SIDEBAR_LABEL;
}
