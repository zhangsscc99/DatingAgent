/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P133 — skip-to-content link. Source-level assertions: the link must be the
 * first focusable element in App, <main> must be a real anchor target that can
 * receive keyboard focus without becoming a tab stop, and the CSS must keep the
 * link invisible until :focus/:focus-visible.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const css = readFileSync(join(SRC, 'App.css'), 'utf8');
const chatWindow = readFileSync(join(SRC, 'components', 'ChatWindow.tsx'), 'utf8');

describe('P133 · skip-to-content link', () => {
  it('renders a skip link pointing at the main content', () => {
    expect(app).toContain('className="skip-link"');
    expect(app).toContain('href="#main-content"');
    expect(app).toContain('跳到主要内容');
  });

  it('places the skip link before the <main> region', () => {
    const linkIndex = app.indexOf('className="skip-link"');
    const mainIndex = app.indexOf('<main');
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeGreaterThan(linkIndex);
  });

  it('makes <main> a programmatically focusable anchor target', () => {
    const mainTag = app.match(/<main\b[^>]*>/)?.[0] ?? '';
    expect(mainTag).toContain('id="main-content"');
    expect(mainTag).toContain('tabIndex={-1}');
  });

  it('hides the link at rest and reveals it on focus', () => {
    expect(css).toMatch(/\.skip-link\s*\{/);
    expect(css).toMatch(/\.skip-link:focus(-visible)?\b/);
  });

  it('gates the composer mount autofocus behind first interaction', () => {
    const mountEffect = chatWindow.match(/P105[\s\S]*?\},\s*\[\]\s*\)/)?.[0] ?? '';
    expect(mountEffect).toContain('hasInteracted');
  });
});
