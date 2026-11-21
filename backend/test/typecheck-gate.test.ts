import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P418 — the root `npm run typecheck` was a dead script: there is no root
 * tsconfig.json, so bare `tsc --noEmit` printed the tsc help text and exited 1,
 * and backend had no typecheck script at all — meaning the P417 type gate had
 * no entry point that actually ran. The fix makes the root script delegate to
 * the workspaces (`--workspaces --if-present`), adds backend `typecheck`, and
 * adds a root `verify` = typecheck + test as the single pre-commit gate.
 * These are source-level assertions on package.json contents plus the
 * invariant that no root tsconfig.json exists (which would tempt someone to
 * re-wire root typecheck to bare tsc again).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Pkg = { scripts?: Record<string, string> };
function pkgScripts(rel: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, rel, 'package.json'), 'utf8')) as Pkg;
  return pkg.scripts ?? {};
}

describe('P418 typecheck gate wiring', () => {
  it('backend, frontend and root all define a non-empty scripts.typecheck', () => {
    for (const rel of ['backend', 'frontend', '.']) {
      const s = pkgScripts(rel)['typecheck'];
      expect(typeof s, `${rel}/package.json scripts.typecheck`).toBe('string');
      expect((s as string).trim().length, `${rel}/package.json scripts.typecheck`).toBeGreaterThan(0);
    }
  });

  it('root typecheck delegates to --workspaces and never runs bare tsc --noEmit', () => {
    const root = pkgScripts('.')['typecheck'] as string;
    expect(root).toContain('--workspaces');
    expect(root).not.toMatch(/\btsc\b/);
    expect(root).not.toContain('tsc --noEmit');
  });

  it('root verify runs both typecheck and test', () => {
    const verify = pkgScripts('.')['verify'];
    expect(typeof verify).toBe('string');
    expect(verify).toContain('typecheck');
    expect(verify).toContain('test');
  });

  it('repo root has no tsconfig.json (root typecheck must delegate, not compile)', () => {
    expect(existsSync(join(ROOT, 'tsconfig.json'))).toBe(false);
  });
});
