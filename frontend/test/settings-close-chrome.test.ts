/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import SettingsSheet from '../src/components/SettingsSheet';

/**
 * P414 — the settings sheet's top-right close × computed to a magenta ring
 * at 390×844 (the sheet auto-focuses it on open and its :focus-visible
 * outline was var(--accent)): a second full-strength accent on a screen
 * that already shows a brand-solid selected segment — game-detail-bar's
 * "two equally strong accent elements" violation.
 *
 * The fix is pure CSS: the close is now a borderless neutral-grey icon
 * button whose hover/focus/active affordances resolve to --surface-hover /
 * --text-muted, while .settings-segment.active keeps the one brand solid
 * fill per screen. Vitest runs in node with no CSS engine, so "computed"
 * is reproduced at source level: we cascade the real rules (base +
 * pseudo-state + media-query) and resolve var() against index.css :root.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const settingsCss = readFileSync(join(SRC, 'components', 'SettingsSheet.css'), 'utf8');
const indexCss = readFileSync(join(SRC, 'index.css'), 'utf8');

const noop = () => {};

/** Custom properties from the first `:root { … }` block (light palette). */
function rootVars(css: string): Map<string, string> {
  const m = css.match(/:root\s*\{([^}]*)\}/);
  expect(m, 'index.css should declare a :root block').toBeTruthy();
  const vars = new Map<string, string>();
  for (const part of m![1].split(';')) {
    const d = part.match(/(--[\w-]+)\s*:\s*(.+)/);
    if (d) vars.set(d[1], d[2].trim());
  }
  return vars;
}

const VARS = rootVars(indexCss);

/** Resolve var(--x) — this repo never nests var() inside var(). */
const resolveVars = (value: string): string =>
  value.replace(/var\((--[\w-]+)\)/g, (all, name: string) => VARS.get(name) ?? all);

interface Rule {
  selector: string;
  body: string;
}

/** Every `selector { decls }` rule touching `selRe`, split on commas; rules
 *  nested inside @media blocks are captured too because we scan raw text.
 *  Comments are stripped first so they can't leak into a selector. */
function rulesMatching(css: string, selRe: RegExp): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const group = m[1].trim();
    if (group.startsWith('@')) continue;
    for (const selector of group.split(',')) {
      const sel = selector.trim();
      if (selRe.test(sel)) out.push({ selector: sel, body: m[2] });
    }
  }
  return out;
}

function declarations(body: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const part of body.split(';')) {
    const d = part.match(/([\w-]+)\s*:\s*(.+)/);
    if (d) decls.set(d[1].trim(), d[2].trim());
  }
  return decls;
}

/** Cascaded declarations for `.settings-close` in one state: base rules in
 *  file order first, then the state's pseudo rules in file order. */
function computedClose(pseudo?: string): Map<string, string> {
  const wanted = pseudo ? `.settings-close:${pseudo}` : '.settings-close';
  const rules = rulesMatching(settingsCss, /^\.settings-close(:[\w-]+)?$/);
  const merged = new Map<string, string>();
  for (const rule of rules.filter((r) => r.selector === '.settings-close')) {
    for (const [k, v] of declarations(rule.body)) merged.set(k, v);
  }
  for (const rule of rules.filter((r) => r.selector === wanted)) {
    for (const [k, v] of declarations(rule.body)) merged.set(k, v);
  }
  return merged;
}

/** Brand accent in every spelling the stylesheet could emit. */
const BRAND = ['#d81b74', 'rgb(216, 27, 116)', 'rgb(216,27,116)'];
const isBrand = (value: string) => BRAND.includes(resolveVars(value).toLowerCase());

/** Border as the box model computes it: 'none' when style/border kills it,
 *  else the pixel width (0 when no border is declared at all). */
function borderWidthPx(decls: Map<string, string>): number | 'none' {
  if (decls.get('border-style') === 'none') return 'none';
  const border = decls.get('border') ?? '';
  if (/\bnone\b/.test(border)) return 'none';
  if (decls.has('border-width')) return parseFloat(decls.get('border-width')!);
  const w = border.match(/(\d+(?:\.\d+)?)px/);
  if (w) return parseFloat(w[1]);
  // `border: 0` / `border: none` covered above; bare `border: <style>` means
  // the medium default — treat any unparseable non-empty shorthand as 3px.
  return border.trim() ? 3 : 0;
}

function renderSheet() {
  return renderToStaticMarkup(
    createElement(SettingsSheet, {
      open: true,
      onClose: noop,
      replyLength: 'default',
      onReplyLengthChange: noop,
      language: 'auto',
      onLanguageChange: noop,
      theme: 'light',
      onThemeChange: noop,
      canExport: false,
      hasSessions: false,
      onExportMarkdown: noop,
      onExportJson: noop,
      onClearAll: noop,
    }),
  );
}

describe('P414 · settings close chrome is neutral, never brand', () => {
  it('no .settings-close rule references the brand accent in any property', () => {
    const rules = rulesMatching(settingsCss, /^\.settings-close(:[\w-]+)?$/);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.body, `${rule.selector} must not use --accent`).not.toMatch(/--accent/);
      expect(rule.body.toLowerCase(), `${rule.selector} must not hard-code the brand hex`).not.toContain('#d81b74');
    }
  });

  it.each([undefined, 'hover', 'focus-visible', 'active'] as const)(
    'computed border-color is not brand and border-width <= 1px in %s state',
    (pseudo) => {
      const decls = computedClose(pseudo);
      for (const prop of ['border-color', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left']) {
        const value = decls.get(prop);
        if (value) expect(isBrand(value), `${prop}: ${value}`).toBe(false);
      }
      const width = borderWidthPx(decls);
      if (width !== 'none') {
        expect(width, 'border-width must be <= 1px').toBeLessThanOrEqual(1);
      }
    },
  );

  it('is a borderless neutral icon button: transparent bg, muted fg, grey hover/focus', () => {
    const base = computedClose();
    expect(base.get('border')).toMatch(/\bnone\b|\b0\b/);
    expect(base.get('background')).toBe('transparent');
    expect(base.get('color')).toBe('var(--text-muted)');

    for (const state of ['hover', 'focus-visible', 'active'] as const) {
      const decls = computedClose(state);
      const bg = resolveVars(decls.get('background') ?? '');
      // light neutral grey surface-hover, never the accent tint
      expect(bg, `${state} background`).toBe('#f0f0f5');
    }
    // The focus ring survives (a11y) but in neutral grey, not brand.
    expect(resolveVars(computedClose('focus-visible').get('outline') ?? '')).toContain('#6b6b7d');
  });

  it('keeps a >=40px touch target inside the mobile media query', () => {
    const mediaStart = settingsCss.indexOf('@media (max-width: 768px)');
    expect(mediaStart).toBeGreaterThan(-1);
    const media = settingsCss.slice(mediaStart);
    const close = media.match(/\.settings-close\s*\{([^}]*)\}/);
    expect(close).toBeTruthy();
    for (const prop of ['width', 'height']) {
      const m = close![1].match(new RegExp(`${prop}:\\s*(\\d+)px`));
      expect(m, `.settings-close ${prop} >= 40px on mobile`).toBeTruthy();
      expect(Number(m![1])).toBeGreaterThanOrEqual(40);
    }
  });

  it('renders aria-label="关闭设置" with no visible text beyond the × glyph', () => {
    const html = renderSheet();
    const btn = html.match(/<button[^>]*class="settings-close"[^>]*>([^<]*)<\/button>/);
    expect(btn).toBeTruthy();
    expect(btn![0]).toContain('aria-label="关闭设置"');
    expect(btn![1].trim()).toBe('×');
  });

  it('the same screen still shows a brand-solid selected segment — the one allowed accent', () => {
    const html = renderSheet();
    // At least one segmented control exposes a pressed/selected option.
    expect(html).toContain('class="settings-segment active"');
    expect(html).toContain('aria-pressed="true"');
    // …and its selected fill is the one brand solid on the screen.
    const active = rulesMatching(settingsCss, /^\.settings-segment\.active$/);
    expect(active.length).toBeGreaterThan(0);
    const bg = resolveVars(declarations(active[0].body).get('background') ?? '');
    expect(bg).toBe('#d81b74');
  });
});
