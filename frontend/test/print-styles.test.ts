/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P134 — Ctrl+P on the chat view used to print the whole application chrome
 * (sidebar, composer, header actions, toasts, status footer) with the
 * transcript squeezed between them. frontend/src/print.css adds a single
 * @media print block that hides the chrome and unclips the scroll containers
 * so the transcript flows across pages. Screen rendering is unaffected.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ');

const css = read('print.css');

describe('P134 · print stylesheet', () => {
  it('exists and contains exactly one @media print block', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css.match(/@media\s+print\s*\{/g)).toHaveLength(1);
  });

  it('hides the composer', () => {
    expect(norm(css)).toMatch(/\.input-bar[^{}]*\{[^}]*display:\s*none/);
  });

  it('hides the sidebar / session chrome', () => {
    const n = norm(css);
    expect(n).toMatch(/\.sidebar[^{}]*\{[^}]*display:\s*none/);
    expect(n).toMatch(/\.sidebar-backdrop[^{}]*\{[^}]*display:\s*none/);
    expect(n).toMatch(/\.header-actions[^{}]*\{[^}]*display:\s*none/);
  });

  it('neutralises inner scrolling on the transcript container', () => {
    const n = norm(css);
    expect(n).toMatch(
      /\.messages[^{}]*\{[^}]*overflow:\s*visible[^}]*\}/,
    );
    expect(n).toMatch(
      /\.chat-window[^{}]*\{[^}]*height:\s*auto[^}]*max-height:\s*none[^}]*overflow:\s*visible/,
    );
  });

  it('keeps bubbles whole across page breaks', () => {
    expect(norm(css)).toContain('break-inside: avoid');
  });

  it('is imported exactly once from main.tsx', () => {
    const main = read('main.tsx');
    const imports = main.match(/import\s+['"]\.\/print\.css['"]/g);
    expect(imports).toHaveLength(1);
  });
});
