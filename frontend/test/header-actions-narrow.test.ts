/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P183 — at a 390px (or 360px) viewport the three header export buttons
 * overflowed the screen: `.header-actions` measured right=812px while the
 * viewport was 390 wide, so 导出 JSON / 复制 Markdown were unreachable.
 * The fix splits each button into a persistent icon span and a
 * `.btn-label` that the 768px media query hides, shrinking the buttons to
 * icon-only on narrow screens. These tests lock that contract at source
 * level (no Playwright in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appTsx = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const appCss = readFileSync(join(SRC, 'App.css'), 'utf8');

describe('P183 narrow-screen header export buttons', () => {
  it('all three export buttons render btn-icon and btn-label spans', () => {
    for (const cls of ['export-btn', 'export-json-btn', 'copy-export-btn']) {
      const start = appTsx.indexOf(`className={\`${cls}`);
      expect(start, `${cls} button`).toBeGreaterThan(-1);
      const body = appTsx.slice(start, appTsx.indexOf('</button>', start));
      expect(body).toContain('className="btn-icon"');
      expect(body).toContain('aria-hidden="true"');
      expect(body).toContain('className="btn-label"');
      expect(body).toContain('aria-label=');
    }
  });

  it('the 768px media query hides .btn-label', () => {
    const mediaStart = appCss.indexOf('@media (max-width: 768px)');
    expect(mediaStart).toBeGreaterThan(-1);
    const mediaEnd = appCss.indexOf('@media', mediaStart + 10);
    const block = appCss.slice(mediaStart, mediaEnd === -1 ? undefined : mediaEnd);
    expect(block).toMatch(/\.btn-label\s*\{[^}]*display:\s*none/);
  });

  it('does not mask header overflow with overflow: hidden', () => {
    const mediaStart = appCss.indexOf('@media (max-width: 768px)');
    const mediaEnd = appCss.indexOf('@media', mediaStart + 10);
    const block = appCss.slice(mediaStart, mediaEnd === -1 ? undefined : mediaEnd);
    expect(block).not.toMatch(/overflow:\s*hidden/);
    expect(block).not.toMatch(/overflow-x:\s*hidden/);
  });
});
