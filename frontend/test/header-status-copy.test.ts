/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headerStatusCopy } from '../src/lib/headerStatus';

/**
 * P249 — the header status row used to read 「LLM 已连接」/「Demo 模式」: a vendor
 * term aimed at a dating-advice user, plus a label that made the build sound
 * crippled. The visible copy is now product language (「顾问在线」/「体验模式」);
 * model availability survives only in the title/aria detail. These tests lock
 * the copy at the pure-function level plus source-level checks on the header
 * markup in App.tsx (no DOM renderer for App here).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appTsx = readFileSync(join(SRC, 'App.tsx'), 'utf8');

const JARGON = ['LLM', 'Demo'];

const statusBlock =
  /className="header-status"[\s\S]*?<\/div>/.exec(appTsx)?.[0] ?? '';

describe('P249 · header status copy is product language', () => {
  it('reachable branch reads exactly 「顾问在线」', () => {
    const copy = headerStatusCopy(true);
    expect(copy.label).toBe('顾问在线');
    for (const word of JARGON) expect(copy.label).not.toContain(word);
  });

  it('unconfigured branch reads exactly 「体验模式」', () => {
    const copy = headerStatusCopy(false);
    expect(copy.label).toBe('体验模式');
    for (const word of JARGON) expect(copy.label).not.toContain(word);
  });

  it('keeps model-availability wording in the title/aria detail', () => {
    expect(headerStatusCopy(true).detail).toContain('模型');
    expect(headerStatusCopy(false).detail).toContain('模型');
  });

  it('App.tsx no longer renders the old jargon strings', () => {
    expect(appTsx).not.toContain('LLM 已连接');
    expect(appTsx).not.toContain('Demo 模式');
    for (const word of JARGON) expect(statusBlock).not.toContain(word);
  });

  it('keeps the status dot and exposes the detail via title/aria-label', () => {
    expect(statusBlock).toContain('status-dot');
    expect(statusBlock).toContain('title=');
    expect(statusBlock).toContain('aria-label=');
    expect(statusBlock).toContain('headerStatus.label');
  });
});
