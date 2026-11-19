/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import InputBar from '../src/components/InputBar';
import { draftStorageKey, DEFAULT_DRAFT_ID } from '../src/lib/chatDrafts';
import type { ChatMessage } from '../src/types';

/**
 * P290 — the first screen gets exactly one brand-solid `data-primary-cta`
 * action; every other control on it is outline or text. P312 moved that
 * single action into the composer itself: the send key now carries the
 * marker (muted secondary fill while the box is empty, brand solid once
 * text exists), and the welcome block's duplicate「开始」button was
 * replaced by passive guidance copy — .welcome renders no button that
 * focuses or submits the composer.
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
const inputBarTsx = read('components/InputBar.tsx');

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

describe('P290/P312 · one primary CTA on the first screen — the composer send key', () => {
  it('renders exactly one [data-primary-cta] element, on the send button', () => {
    const markup = renderWelcome();
    expect(markup.match(/data-primary-cta/g)).toHaveLength(1);
    const send = buttonTag(markup, 'input-send');
    expect(send).toContain('data-primary-cta');
    // The marker lives inside the composer, not the welcome column.
    const welcome = markup.slice(
      markup.indexOf('class="welcome'),
      markup.indexOf('class="input-bar'),
    );
    expect(welcome).not.toContain('data-primary-cta');
  });

  it('the welcome block keeps passive guidance on desktop — the compact screen gets the hero button', () => {
    // SSR renders the ≥769px hero (no window → compactFeatures false), so
    // the markup keeps the hint paragraph and never shows the compact CTA.
    const markup = renderWelcome();
    expect(markup).toContain('class="welcome-hint"');
    expect(markup).toContain('在下方输入框');
    expect(markup).not.toContain('welcome-primary-cta');
    expect(markup).not.toContain('说说你的情况');
    expect(markup).not.toContain('hero-primary-cta');
    // The hint is a paragraph; P374's compact-only hero button is the one
    // welcome element allowed to reach the composer — and only to focus
    // it, never to send.
    const welcomeBlock = chatWindowTsx.slice(
      chatWindowTsx.indexOf('className="welcome'),
      chatWindowTsx.indexOf('renderedMessages.map'),
    );
    expect(welcomeBlock).toContain('<p className="welcome-hint">');
    expect(welcomeBlock).toContain('data-testid="hero-primary-cta"');
    expect(welcomeBlock).toContain('inputRef.current?.focus()');
  });

  it('the send key keeps its brand solid; only the compact hero button shares it', () => {
    const rule = ruleBody(inputBarCss, '.input-bar .input-send');
    expect(rule).toContain('background: var(--accent)');
    expect(rule).toContain('color: var(--on-accent)');
    // The retired welcome button's rules are gone; P374's compact-only
    // hero action is the one welcome element allowed the fill — it is the
    // phone first screen's obvious next action — while every other
    // welcome control stays secondary.
    expect(ruleBody(chatWindowCss, '.welcome-primary-cta')).toBe('');
    expect(ruleBody(chatWindowCss, '.hero-cta-primary')).toContain(
      'background: var(--accent)',
    );
    for (const secondary of ['.welcome-cta', '.starter-chip', '.profile-nudge-btn', '.hero-cta-card']) {
      expect(ruleBody(chatWindowCss, secondary)).not.toContain(
        'background: var(--accent)',
      );
    }
  });

  it('the marker stays on the send key with or without the profile entry', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, { messages: [], loading: false, onSend: noop }),
    );
    expect(markup.match(/data-primary-cta/g)).toHaveLength(1);
    expect(buttonTag(markup, 'input-send')).toContain('data-primary-cta');
    expect(markup).not.toContain('welcome-cta');
  });

  it('still renders exactly one [data-primary-cta] once a conversation exists', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '她说明天要加班' },
      { id: 'a1', role: 'assistant', content: '先接住她的情绪…' },
    ];
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, { messages, loading: false, onSend: noop }),
    );
    expect(markup.match(/data-primary-cta/g)).toHaveLength(1);
    expect(buttonTag(markup, 'input-send')).toContain('data-primary-cta');
    expect(markup).not.toContain('welcome-hint');
  });

  it('the marker follows the single primary — send while idle, 停止 while streaming', () => {
    // P326: the pending state hands the one primary slot to 停止生成 —
    // the queueing send key drops the marker and takes the secondary
    // register instead. Each state renders exactly one marker.
    const pending = renderToStaticMarkup(
      createElement(InputBar, { onSend: noop, streaming: true, onStop: noop }),
    );
    expect(pending.match(/data-primary-cta/g)).toHaveLength(1);
    expect(buttonTag(pending, 'input-stop')).toContain('data-primary-cta');
    expect(buttonTag(pending, 'input-send')).not.toContain('data-primary-cta');
    // Idle markup keeps the marker on send (asserted above too), and the
    // source still declares it ahead of the stop button.
    const idle = renderWelcome();
    expect(buttonTag(idle, 'input-send')).toContain('data-primary-cta');
    const sendIdx = inputBarTsx.indexOf('data-primary-cta');
    const stopIdx = inputBarTsx.indexOf('input-send input-stop');
    expect(sendIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeLessThan(stopIdx);
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

  it('the welcome hint reads as muted guidance, not a control', () => {
    const rule = ruleBody(chatWindowCss, '.welcome > p.welcome-hint');
    expect(rule).not.toBe('');
    // Passive copy: no accent, no border, no cursor affordance.
    expect(rule).not.toContain('var(--accent)');
    expect(rule).not.toContain('cursor');
    const markup = renderWelcome();
    expect(markup).toContain('<p class="welcome-hint">');
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

  it('the send key is disabled while the composer is empty, but keeps the brand fill', () => {
    stubDraftStorage({});
    const markup = renderWelcome();
    const send = buttonTag(markup, 'input-send');
    expect(send).toContain('disabled=""');
    expect(send).toContain('aria-label="发送消息"');
    // P336: `disabled` blocks the action, it must not read disabled — the
    // muted --surface-hover ghost is gone; the empty key keeps the screen's
    // single brand solid.
    const rule = ruleBody(inputBarCss, '.input-bar .input-send:disabled');
    expect(rule).toContain('background: var(--accent)');
    expect(rule).toContain('color: var(--on-accent)');
    expect(rule).not.toContain('var(--surface-hover)');
    expect(rule).not.toContain('var(--text-muted)');
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
      [chatWindowCss, '.welcome-cta:focus-visible'],
      [inputBarCss, '.input-bar .input-send:focus-visible'],
    ] as const) {
      expect(ruleBody(css, sel)).toContain('outline: 2px solid var(--accent)');
    }
  });
});
