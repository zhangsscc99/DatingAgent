/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import { draftStorageKey, DEFAULT_DRAFT_ID } from '../src/lib/chatDrafts';
import type { ChatMessage } from '../src/types';

/**
 * P290 — first screen had two competing brand actions: the dashed accent
 * 「完善资料」 welcome chip and the solid pink send key (visible even while
 * disabled), so the eye had no landing point. The welcome block now renders
 * exactly one brand-solid `data-primary-cta` button (「说说你的情况」, which
 * focuses the composer); 「完善资料」 / the profile nudge are quiet outline
 * actions in muted text, and the empty-composer send key is a muted
 * secondary fill that only turns brand solid once text exists.
 *
 * Vitest runs in node with no DOM — markup assertions go through
 * renderToStaticMarkup (same as interrupted-turn-restore.test.ts) and the
 * colour contract is pinned on the CSS source.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const chatWindowTsx = read('components/ChatWindow.tsx');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');

/** Declaration bodies of every `selector { … }` — exact selector match. */
function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
    (m) => m[1],
  );
}

/** Declaration body of the first `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  return ruleBodies(css, selector)[0] ?? '';
}

/** Opening `<button …>` tag whose class list contains `cls`. */
function buttonTag(markup: string, cls: string): string {
  const tags = markup.match(/<button[^>]*>/g) ?? [];
  return (
    tags.find((t) => t.includes(`class="${cls}`) || t.includes(` ${cls}"`)) ?? ''
  );
}

const noop = () => {};

function renderWelcome(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: [] as ChatMessage[],
      loading: false,
      onSend: noop,
      onSetupProfile: noop,
      ...extra,
    }),
  );
}

function stubDraftStorage(entries: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => entries[k] ?? null,
    setItem: noop,
    removeItem: noop,
    clear: noop,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P290 · one primary CTA on the empty welcome screen', () => {
  it('renders exactly one [data-primary-cta] element on the first screen', () => {
    const markup = renderWelcome();
    expect(markup.match(/data-primary-cta/g)).toHaveLength(1);
    const cta = buttonTag(markup, 'welcome-primary-cta');
    expect(cta).toContain('data-primary-cta');
    expect(markup).toContain('说说你的情况');
  });

  it('the primary CTA is the only brand-solid button in the welcome CSS', () => {
    const rule = ruleBody(chatWindowCss, '.welcome-primary-cta');
    expect(rule).toContain('background: var(--accent)');
    expect(rule).toContain('color: var(--on-accent)');
    // No other welcome button keeps a solid accent fill.
    for (const secondary of ['.welcome-cta', '.starter-chip', '.profile-nudge-btn']) {
      expect(ruleBody(chatWindowCss, secondary)).not.toContain(
        'background: var(--accent)',
      );
    }
  });

  it('the primary CTA hands focus to the composer', () => {
    const ctaBlock = chatWindowTsx.slice(
      chatWindowTsx.indexOf('data-primary-cta'),
      chatWindowTsx.indexOf('说说你的情况'),
    );
    expect(ctaBlock).toContain('inputRef.current?.focus()');
  });

  it('still renders exactly one [data-primary-cta] without the profile entry', () => {
    // onSetupProfile absent → no welcome-cta; the count must stay one.
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, { messages: [], loading: false, onSend: noop }),
    );
    expect(markup.match(/data-primary-cta/g)).toHaveLength(1);
    expect(markup).not.toContain('welcome-cta');
  });

  it('renders no [data-primary-cta] once a conversation exists', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '她说明天要加班' },
      { id: 'a1', role: 'assistant', content: '先接住她的情绪…' },
    ];
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, { messages, loading: false, onSend: noop }),
    );
    expect(markup).not.toContain('data-primary-cta');
  });
});

describe('P290 · every other first-screen action is secondary', () => {
  it('「完善资料」 welcome CTA is a muted outline button, not a brand chip', () => {
    const rule = ruleBody(chatWindowCss, '.welcome-cta');
    expect(rule).toContain('border: 1px solid var(--border)');
    expect(rule).toContain('color: var(--text-secondary)');
    expect(rule).not.toContain('dashed');
    expect(rule).not.toContain('var(--accent)');
    // …but it keeps its reachable labelled form on the welcome screen.
    const markup = renderWelcome();
    const cta = buttonTag(markup, 'welcome-cta');
    expect(cta).toContain('class="welcome-cta"');
    expect(markup).toContain('完善资料，获得更个性化建议');
  });

  it('the profile nudge is absent on the empty first screen and muted when it appears', () => {
    // Empty welcome: the P255 nudge needs a real assistant reply first.
    const markup = renderWelcome();
    expect(markup).not.toContain('profile-nudge');
    // When it does appear its resting state is muted text, not accent —
    // the base rule carries the colour (the ≤768px rule only sizes it).
    const bodies = ruleBodies(chatWindowCss, '.profile-nudge-btn');
    expect(bodies.some((b) => b.includes('color: var(--text-secondary)'))).toBe(true);
    expect(bodies.every((b) => !b.includes('color: var(--accent)'))).toBe(true);
  });

  it('the send key is disabled and muted while the composer is empty', () => {
    stubDraftStorage({});
    const markup = renderWelcome();
    const send = buttonTag(markup, 'input-send');
    expect(send).toContain('disabled=""');
    expect(send).toContain('aria-label="发送消息"');
    // The disabled rule is a secondary fill — no accent background.
    const rule = ruleBody(inputBarCss, '.input-bar .input-send:disabled');
    expect(rule).toContain('background: var(--surface-hover)');
    expect(rule).not.toContain('var(--accent)');
  });

  it('the send key returns to brand solid once the composer has text', () => {
    stubDraftStorage({ [draftStorageKey(DEFAULT_DRAFT_ID)]: '她回复很冷淡' });
    const markup = renderWelcome();
    const send = buttonTag(markup, 'input-send');
    expect(send).not.toContain('disabled');
    // The enabled rule keeps the brand fill.
    const rule = ruleBody(inputBarCss, '.input-bar .input-send');
    expect(rule).toContain('background: var(--accent)');
    expect(rule).toContain('color: var(--on-accent)');
  });

  it('both surfaces keep a visible focus ring', () => {
    for (const [css, sel] of [
      [chatWindowCss, '.welcome-primary-cta:focus-visible'],
      [chatWindowCss, '.welcome-cta:focus-visible'],
      [inputBarCss, '.input-bar .input-send:focus-visible'],
    ] as const) {
      expect(ruleBody(css, sel)).toContain('outline: 2px solid var(--accent)');
    }
  });
});
