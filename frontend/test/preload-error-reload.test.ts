/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, FakeEvent, type FakeDom } from './helpers/fakeDom';

/**
 * P433 — a tab left open across a deploy keeps requesting chunks by their old
 * content-hashed names; after P430 those paths 404 (earlier they got the SPA
 * HTML), the module fails to load and Vite fires `vite:preloadError`. main.tsx
 * now reloads once per session on that event, guarded by a sessionStorage
 * flag written BEFORE the reload so a still-broken next load cannot loop.
 *
 * Behavioural side is driven against the repo fake DOM: main.tsx is imported
 * with App mocked out (the listener registration is what is under test, not
 * the render), sessionStorage/location are injected fakes, and the event is
 * dispatched like the browser would.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const mainSrc = readFileSync(join(SRC, 'main.tsx'), 'utf8');
const KEY = 'datingagent.preloadReloadAttempted';

vi.mock('../src/App', () => ({ default: () => null }));

const memStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(String(k), String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    map,
  };
};

let dom: FakeDom;
let reloadCount = 0;
let flagAtReload: string | null = null;
let storage = memStorage();

const install = async () => {
  dom = installFakeDom();
  reloadCount = 0;
  flagAtReload = null;
  storage = memStorage();
  (dom.window as Record<string, unknown>).sessionStorage = storage;
  vi.stubGlobal('sessionStorage', storage);
  const location = {
    href: 'http://localhost/',
    reload: () => {
      reloadCount += 1;
      flagAtReload = storage.map.get(KEY) ?? null;
    },
  };
  (dom.window as Record<string, unknown>).location = location;
  vi.stubGlobal('location', location);
  const root = dom.document.createElement('div');
  root.id = 'root';
  dom.document.body.appendChild(root);
  // Fresh module graph per session: the listener must bind to THIS window.
  vi.resetModules();
  await import('../src/main');
};

const fire = () =>
  dom.window.dispatchEvent(new FakeEvent('vite:preloadError'));

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('P433 · vite:preloadError reload-once contract', () => {
  it('main.tsx registers the vite:preloadError listener with a sessionStorage one-shot guard', () => {
    expect(mainSrc).toContain('vite:preloadError');
    expect(mainSrc).toMatch(/addEventListener\('vite:preloadError'/);
    expect(mainSrc).toContain('sessionStorage');
    expect(mainSrc).toContain('location.reload()');
    // One-shot guard: flag read gates the reload, flag written before it.
    const gate = mainSrc.indexOf('getItem(PRELOAD_RELOAD_KEY)');
    const mark = mainSrc.indexOf('setItem(PRELOAD_RELOAD_KEY');
    const reload = mainSrc.indexOf('location.reload()');
    expect(gate).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(mark);
    expect(mark).toBeLessThan(reload);
  });

  it('dispatching vite:preloadError twice in one session reloads exactly once', async () => {
    await install();
    fire();
    expect(reloadCount).toBe(1);
    // The one-shot flag was written before the reload fired.
    expect(flagAtReload).toBe('1');
    // Second dispatch in the same session: guarded, no second reload.
    fire();
    expect(reloadCount).toBe(1);
  });

  it('a later session whose storage still carries the flag never reloads', async () => {
    await install();
    storage.map.set(KEY, '1');
    fire();
    expect(reloadCount).toBe(0);
  });

  it('throwing storage neither crashes nor reloads (no loop without a guard)', async () => {
    await install();
    const broken = {
      getItem: () => {
        throw new Error('disabled');
      },
      setItem: () => {
        throw new Error('disabled');
      },
      removeItem: () => {
        throw new Error('disabled');
      },
    };
    (dom.window as Record<string, unknown>).sessionStorage = broken;
    vi.stubGlobal('sessionStorage', broken);
    expect(() => fire()).not.toThrow();
    expect(reloadCount).toBe(0);
  });
});
