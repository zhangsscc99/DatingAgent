/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * F15 — regression guard for the accessibility contract. These are source-level
 * assertions (no DOM): they fail when a new icon button loses its label, when a
 * new animation ships without a reduced-motion escape hatch, or when a control
 * strips the native focus ring without drawing its own.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC).sort();
const cssFiles = files.filter((f) => f.endsWith('.css'));
const tsxFiles = files.filter((f) => f.endsWith('.tsx'));

const rel = (file: string) => relative(SRC, file).replace(/\\/g, '/');
const read = (file: string) => readFileSync(file, 'utf8');

/** Attributes of every `<button …>` opening tag, with `{…}` depth tracked. */
function buttonTags(source: string): { attrs: string; body: string; line: number }[] {
  const found: { attrs: string; body: string; line: number }[] = [];
  let cursor = 0;

  while ((cursor = source.indexOf('<button', cursor)) !== -1) {
    let i = cursor + '<button'.length;
    let braces = 0;
    let quote: string | null = null;

    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '>' && braces === 0) break;
    }

    const attrs = source.slice(cursor + '<button'.length, i);

    if (source[i - 1] === '/') {
      found.push({ attrs, body: '', line: source.slice(0, cursor).split('\n').length });
      cursor = i + 1;
      continue;
    }

    let depth = 1;
    let scan = i + 1;
    let bodyEnd = -1;
    while (scan < source.length) {
      const open = source.indexOf('<button', scan);
      const close = source.indexOf('</button>', scan);
      if (close === -1) break;
      if (open !== -1 && open < close) {
        depth++;
        scan = open + '<button'.length;
        continue;
      }
      depth--;
      scan = close + '</button>'.length;
      if (depth === 0) {
        bodyEnd = close;
        break;
      }
    }

    found.push({
      attrs,
      body: bodyEnd < 0 ? '' : source.slice(i + 1, bodyEnd),
      line: source.slice(0, cursor).split('\n').length,
    });
    cursor = i + 1;
  }

  return found;
}

/** Visible text of a JSX fragment, without tags or `{expressions}`. */
function visibleText(jsx: string): string {
  let text = jsx;
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(/\{[^{}]*\}/g, '');
  }
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\p{P}\p{S}\p{Emoji_Presentation}]/gu, '');
}

const hasName = (attrs: string) => /\b(aria-label|aria-labelledby|title)=/.test(attrs);

describe('F15 · accessibility', () => {
  it('gives every icon-only button an accessible name', () => {
    const offenders: string[] = [];

    for (const file of tsxFiles) {
      const source = read(file);
      for (const button of buttonTags(source)) {
        if (hasName(button.attrs)) continue;
        if (visibleText(button.body).length > 0) continue;
        offenders.push(`${rel(file)}:${button.line}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('guards CSS animations with prefers-reduced-motion', () => {
    const offenders = cssFiles
      .filter((file) => {
        const css = read(file);
        const animates = /animation:\s*(?!none)[^;]+;/.test(css);
        return animates && !css.includes('@media (prefers-reduced-motion: reduce)');
      })
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('keeps a visible focus indicator wherever the native ring is removed', () => {
    const offenders = cssFiles
      .filter((file) => {
        const css = read(file);
        if (!/outline:\s*none/.test(css)) return false;
        return !(/:focus-visible|:focus-within|box-shadow:\s*0 0 0/.test(css));
      })
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('labels every modal dialog', () => {
    const offenders: string[] = [];

    for (const file of tsxFiles) {
      const source = read(file);
      const modal = /<[a-zA-Z][^>]*aria-modal[^>]*>/g;
      for (const match of source.match(modal) ?? []) {
        if (!/\b(aria-label|aria-labelledby)=/.test(match)) offenders.push(rel(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
